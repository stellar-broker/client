import {Asset, Keypair, Memo, Operation, TransactionBuilder, Horizon, Networks, StrKey, TimeoutInfinite, NotFoundError} from '@stellar/stellar-sdk'
import {fromStroops, toStroops} from './stroops.js'
import {convertToStellarAsset} from './asset.js'
import {AuthorizationWrapper} from './authorization.js'

const defaultStoragePrefix = 'msb_'

export class Mediator {
    /**
     * Create a trader mediator account instance for a given source account
     * @param {string} source - Creator account address
     * @param {string|Asset} sellingAsset - Identifier of the asset to sell
     * @param {string|Asset} buyingAsset - Identifier of the asset to buy
     * @param {string} sellingAmount - Asset amount to sell
     * @param {ClientAuthorizationParams} authorization - Authorization callback or secret key
     * @param {number} [reserveFeeAmount] - Amount reserved to cover tx fees (all unused funds will be refunded)
     */
    constructor(source, sellingAsset, buyingAsset, sellingAmount, authorization, reserveFeeAmount = 5) {
        if (!StrKey.isValidEd25519PublicKey(source))
            throw new Error('Invalid source account')
        this.source = source
        try {
            this.sellingAsset = convertToStellarAsset(sellingAsset)
        } catch (e) {
            console.error(e)
            throw new Error('Invalid selling asset')
        }
        try {
            this.buyingAsset = convertToStellarAsset(buyingAsset)
        } catch (e) {
            console.error(e)
            throw new Error('Invalid buying asset')
        }
        try {
            this.sellingAmount = toStroops(sellingAmount)
        } catch (e) {
            console.error(e)
            throw new Error('Invalid selling amount')
        }
        this.authorization = new AuthorizationWrapper(authorization)
        this.reserveFeeAmount = reserveFeeAmount
    }

    /**
     * Creator account address
     * @type {string}
     * @readonly
     */
    source
    /**
     * @type {Asset}
     * @readonly
     */
    sellingAsset
    /**
     * @type {Asset}
     * @readonly
     */
    buyingAsset
    /**
     * @type {bigint}
     * @readonly
     */
    sellingAmount
    /**
     * @type {AuthorizationWrapper}
     * @private
     */
    authorization
    /**
     * @type {Keypair}
     * @private
     */
    mediator
    /**
     * @type {string}
     * @readonly
     */
    mediatorAddress
    /**
     * Prefix of the mediator address record in the localStorage
     * @type {string}
     * @private
     */
    storagePrefix = defaultStoragePrefix
    /**
     * @type {number}
     * @private
     */
    reserveFeeAmount

    /**
     * Check if there are any non-disposed mediators that belong to lost swap sessions
     * @return {boolean}
     */
    get hasObsoleteMediators() {
        return this.constructor.hasObsoleteMediators(this.source, this.storagePrefix)
    }

    /**
     * Check if there are any non-disposed mediators that belong to lost swap sessions
     * @param {string} source - Initiator account that created a mediator
     * @param {string} [storagePrefix] - Local storage key prefix
     * @return {boolean}
     */
    static hasObsoleteMediators(source, storagePrefix = defaultStoragePrefix) {
        return Object.entries(localStorage).some(([key, initiator]) =>
            initiator === source && key.startsWith(storagePrefix))
    }

    /**
     * Retrieve funds from mediator accounts that belong to lost swap sessions
     * @return {Promise}
     */
    async disposeObsoleteMediators() { //TODO: deal with potential problems caused by concurrent swaps
        for (let [key, initiator] of Object.entries(localStorage)) {
            if (initiator === this.source && key.startsWith(this.storagePrefix)) {
                await this.dispose(key.replace(this.storagePrefix, ''))
            }
        }
    }

    /**
     * Retrieve funds from mediator accounts that belong to lost swap sessions
     * @param {string} source - Initiator account that created a mediator
     * @param {ClientAuthorizationParams} authorization - Authorization callback or secret key
     * @param {string} [storagePrefix] - Local storage key prefix
     * @return {Promise}
     */
    static async disposeObsoleteMediators(source, authorization, storagePrefix = defaultStoragePrefix) {
        const wrapper = new Mediator(source, 'XLM', 'XLM', '0', authorization)
        wrapper.storagePrefix = storagePrefix
        await wrapper.disposeObsoleteMediators()
    }

    /**
     * Create mediator account and deposit tokens to sell
     * @return {Promise<string>} - Newly created mediator secret key
     */
    async init() {
        const sourceAccount = await this.loadAccount(this.source)
        if (!sourceAccount)
            throw new Error('Mediator account doesn\'t exist on the ledger')
        //calculate fees reserve + account entries reserve
        const subentries = 2 + sourceAccount.signers.length - 1 + [this.sellingAsset, this.buyingAsset].filter(a => !a.isNative()).length
        const feesReserve = this.reserveFeeAmount + 0.5 * subentries
        const ops = []
        //create new random keypair for the trade
        this.mediator = Keypair.random()
        this.mediatorAddress = this.mediator.publicKey()
        //create mediator account and deposit funds
        const {sellingAsset, buyingAsset} = this
        if (sellingAsset.isNative()) { //for XLM total amount should include fee reserves
            const amount = this.sellingAmount + BigInt(feesReserve * 10000000)
            //check available balance
            if (toStroops(findTrustline(sourceAccount, sellingAsset).balance) < amount)
                throw new Error('Insufficient XLM balance for selling amount + potential trading fees')
            //only create account is required for asset transfer
            ops.push(Operation.createAccount({
                source: this.source,
                destination: this.mediatorAddress,
                startingBalance: fromStroops(amount)
            }))
        } else {
            //check available XLM balance
            const xlmBalance = findTrustline(sourceAccount, Asset.native())
            if (parseFloat(xlmBalance.balance) < feesReserve)
                throw new Error('Insufficient XLM balance for potential trading fees')
            //create mediator account
            ops.push(Operation.createAccount({
                source: this.source,
                destination: this.mediatorAddress,
                startingBalance: feesReserve.toString() // for tx fees
            }))
            //check available XLM balance
            const sellingTrustline = findTrustline(sourceAccount, this.sellingAsset)
            if (!sellingTrustline || toStroops(sellingTrustline.balance) < this.sellingAmount)
                throw new Error('Insufficient selling asset balance')
            //TODO: check authorizations
            //create trustline for selling asset
            ops.push(Operation.changeTrust({
                source: this.mediatorAddress,
                asset: sellingAsset
            }))
            //transfer tokens to sell
            ops.push(Operation.payment({
                source: this.source,
                asset: sellingAsset,
                destination: this.mediatorAddress,
                amount: fromStroops(this.sellingAmount)
            }))
        }
        //create trustline for buying asset
        if (!buyingAsset.isNative()) {
            ops.push(Operation.changeTrust({
                source: this.mediatorAddress,
                asset: buyingAsset
            }))
            //if source account itself doesn't have trustline for buying asset
            if (!findTrustline(sourceAccount, buyingAsset)) {
                ops.push(Operation.changeTrust({
                    source: this.source,
                    asset: buyingAsset
                }))
            }
        }

        if (sourceAccount.signers.length > 1) { //multisig or delegated schema
            let {thresholds, signers} = sourceAccount
            signers = signers.filter(signer => signer.type === 'ed25519_public_key')
            //add source account as a signer
            ops.push(Operation.setOptions({
                source: this.mediatorAddress,
                inflationDest: this.source, //store source account to the inflation dest
                homeDomain: 'mediator.stellar.broker',
                masterWeight: Math.max(1, thresholds.high_threshold, thresholds.med_threshold), //own signer always has the highest weight
                highThreshold: thresholds.high_threshold,
                medThreshold: thresholds.med_threshold,
                lowThreshold: thresholds.low_threshold,
                signer: { //add first signer
                    ed25519PublicKey: signers[0].key,
                    weight: Math.max(1, signers[0].weight)
                }
            }))
            //add all other signers
            for (let i = 1; i < signers.length; i++) {
                ops.push(Operation.setOptions({
                    source: this.mediatorAddress,
                    signer: { //cope signers and weights
                        ed25519PublicKey: signers[i].key,
                        weight: Math.max(1, signers[i].weight)
                    }
                }))
            }
        } else { //simple schema
            ops.push(Operation.setOptions({
                source: this.mediatorAddress,
                homeDomain: 'mediator.stellar.broker',
                masterWeight: 1,
                highThreshold: 1,
                medThreshold: 1,
                lowThreshold: 1,
                signer: { //add source account as a signer
                    ed25519PublicKey: this.source,
                    weight: 1
                }
            }))
        }

        //store the record in the localStorage
        localStorage.setItem(this.storagePrefix + this.mediatorAddress, this.source)
        //confirm tx
        await this.buildAndSend(sourceAccount, ops)
        //client will need mediator secret for trading
        return this.mediator.secret()
    }

    /**
     * Dispose mediator account
     * @param {string} [address]
     * @return {Promise}
     */
    async dispose(address) {
        if (!address) {
            address = this.mediatorAddress
        }
        //load account
        let mediatorAccount = await this.loadAccount(address)
        if (!mediatorAccount) {
            //remove reference from local storage only if account doesn't exist on the ledger
            localStorage.removeItem(this.storagePrefix + address)
            throw new Error(`Mediator account ${address} doesn't exist on the ledger`)
        }

        if (!mediatorAccount.signers.find(s => s.key === this.source))
            throw new Error(`${address} is not a mediator account for ${this.source}`)
        const ops = []
        //remove trustlines for each account balance
        for (const balance of mediatorAccount.balances) {
            if (balance.asset_type === 'native')
                continue //skip XLM trustline - merge will handle the transfer
            const asset = convertToStellarAsset(balance)
            //transfer remaining balance to the source account
            if (balance.balance > 0) {
                ops.push(Operation.payment({
                    source: address,
                    asset,
                    destination: this.source,
                    amount: balance.balance
                }))
            }
            //remove trustline
            ops.push(Operation.changeTrust({
                source: address,
                asset,
                limit: '0'
            }))
        }
        //merge
        ops.push(Operation.accountMerge({
            source: address,
            destination: this.source
        }))
        if (this.mediatorAddress !== address) {
            mediatorAccount = await this.loadAccount(this.source)
        }
        await this.buildAndSend(mediatorAccount, ops)
        //remove reference from local storage
        localStorage.removeItem(this.storagePrefix + address)
    }

    /**
     * @param {AccountResponse} account
     * @param {Operation[]} operations
     * @param {string} [memo]
     * @private
     */
    async buildAndSend(account, operations, memo) {
        //create builder
        const builder = new TransactionBuilder(account, {
            fee: '1000000',
            networkPassphrase: Networks.PUBLIC
        })
        builder.setTimeout(TimeoutInfinite)
        //add memo if needed
        if (memo) {
            builder.addMemo(Memo.text(memo))
        }
        //add operations
        for (const op of operations) {
            builder.addOperation(op)
        }
        //build tx
        let tx = builder.build()
        //sign it on behalf of the mediator account (if available)
        if (this.mediator) {
            tx.sign(this.mediator)
        }
        //request signature from the client (if required)
        if (account.account_id === this.source) {
            tx = await this.authorization.authorize(tx)
        }
        //execute the tx
        const res = await this.constructor.createHorizon().submitTransaction(tx, {skipMemoRequiredCheck: true})
        if (!res.successful)
            throw new Error('Failed to create mediator account')
    }

    /**
     * @param {string} address
     * @return {Promise<AccountResponse>}
     * @private
     */
    async loadAccount(address) {
        try {
            return await this.constructor.createHorizon().loadAccount(address)
        } catch (e) {
            if (e instanceof NotFoundError) {
                console.warn(`Account ${address} doesn't exist on the ledger`)
                return null
            }
            console.error(e)
            throw e
        }
    }

    /**
     * @return {HorizonServer}
     * @private
     */
    static createHorizon() {
        return new Horizon.Server('https://horizon.stellar.org')
    }
}


/**
 * @param {AccountResponse} account
 * @param {Asset} asset
 * @return {BalanceLine}
 */
function findTrustline(account, asset) {
    return account.balances.find(b => asset.isNative() ?
        b.asset_type === 'native' :
        b.asset_code === asset.code && b.asset_issuer === asset.issuer
    )
}