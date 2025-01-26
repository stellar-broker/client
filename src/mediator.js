import {Asset, Keypair, Memo, Operation, TransactionBuilder, Horizon, Networks, StrKey} from '@stellar/stellar-sdk'
import {fromStroops, toStroops} from './stroops.js'
import {convertToStellarAsset} from './asset.js'
import {AuthorizationWrapper} from './authorization.js'

//additional XLM amount to cover tx fees
const feesReserve = '2'

export class Mediator {
    /**
     * Create a trader mediator account instance for a given source account
     * @param {string} source - Creator account address
     * @param {string|Asset} sellingAsset - Identifier of the asset to sell
     * @param {string|Asset} buyingAsset - Identifier of the asset to buy
     * @param {string} sellingAmount - Asset amount to sell
     * @param {string|ClientAuthorizationCallback} authorization - Authorization
     */
    constructor(source, sellingAsset, buyingAsset, sellingAmount, authorization) {
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
     */
    storagePrefix = 'msb_'

    /**
     * Check if there are any non-disposed mediators that belong to lost swap sessions
     * @return {boolean}
     */
    get hasObsoleteMediators() {
        return Object.entries(localStorage).some(([key, initiator]) =>
            initiator === this.source && key.startsWith(this.storagePrefix))
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
     * Create mediator account and deposit selling tokens
     * @return {Promise<string>} - Newly created mediator secret key
     */
    async init() {
        const sourceAccount = await this.loadAccount(this.source)
        if (!sourceAccount)
            throw new Error('Mediator account doesn\'t exist on the ledger')
        const ops = []
        //create new random keypair for the trade
        this.mediator = Keypair.random()
        this.mediatorAddress = this.mediator.publicKey()
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
            if (xlmBalance.balance < parseInt(feesReserve))
                throw new Error('Insufficient XLM balance for potential trading fees')
            //create mediator account
            ops.push(Operation.createAccount({
                source: this.source,
                destination: this.mediatorAddress,
                startingBalance: feesReserve // for tx fees
            }))
            //check available XLM balance
            const sellingTrustline = findTrustline(sourceAccount, this.sellingAsset)
            if (!sellingTrustline || toStroops(sellingTrustline.balance) < this.sellingAmount)
                throw new Error('Insufficient selling asset balance')
            if (!findTrustline(sourceAccount, this.buyingAsset))
                throw new Error('Source account doesn\'t have buying asset trustline')
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
        //add source account as a signer
        ops.push(Operation.setOptions({
            source: this.mediatorAddress,
            homeDomain: 'mediator.stellar.broker',
            masterWeight: 1,
            highThreshold: 1,
            medThreshold: 1,
            lowThreshold: 1,
            signer: {
                ed25519PublicKey: this.source,
                weight: 1
            }
        }))
        //create trustline for buying asset
        ops.push(Operation.changeTrust({
            source: this.mediatorAddress,
            asset: buyingAsset
        }))
        //confirm tx
        await this.buildAndSend(sourceAccount, ops)
        //store the record in the localStorage
        localStorage.setItem(this.storagePrefix + this.mediatorAddress, this.source)
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
        let account = await this.loadAccount(address)
        if (!account)
            throw new Error(`Mediator account ${address} doesn't exist on the ledger`)

        if (!account.signers.find(s => s.key === this.source))
            throw new Error(`${address} is not a mediator account for ${this.source}`)
        const ops = []
        //remove trustlines for each account balance
        for (const balance of account.balances) {
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
            account = await this.loadAccount(this.source)
        }
        await this.buildAndSend(account, ops)
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
        builder.setTimeout(30)
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
        const res = await this.createHorizon().submitTransaction(tx, {skipMemoRequiredCheck: true})
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
            return this.createHorizon().loadAccount(address)
        } catch (e) {
            console.error(e)
        }
    }

    /**
     * @return {HorizonServer}
     * @private
     */
    createHorizon() {
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