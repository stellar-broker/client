import {Asset, Keypair, Memo, Operation, TransactionBuilder, Horizon, Networks, StrKey} from '@stellar/stellar-sdk'
import {fromStroops, toStroops} from './stroops.js'
import {convertToStellarAsset} from './asset.js'
import {AuthorizationWrapper} from './authorization.js'

//additional XLM amount to cover tx fees
const feesReserve = '2'

class Mediator {
    /**
     * Create a trader mediator account instance for a given source account
     * @param {string} source - Creator account address
     * @param {string|Asset} sellingAsset - Asset identifier to sell
     * @param {string} sellingAmount - Asset amount to sell
     * @param {string|ClientAuthorizationCallback} authorization - Authorization
     */
    constructor(source, sellingAsset, sellingAmount, authorization) {
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
     * @type {Asset}
     * @readonly
     */
    sellingAsset
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
     * @type {boolean}
     * @readonly
     */
    isReady = false

    static async loadExisting() {

    }

    /**
     * Create mediator account and deposit selling tokens
     */
    async init() {
        const sourceAccount = await loadAccount(this.source)
        if (!sourceAccount)
            throw new Error('Mediator account doesn\'t exist on the ledger')
        const ops = []
        //create new random keypair for the trade
        this.mediator = Keypair.random()
        this.mediatorAddress = this.mediator.publicKey()
        //source account sponsors reserves for the mediator
        ops.push(Operation.beginSponsoringFutureReserves({
            sponsoredId: this.mediatorAddress
        }))
        const {asset} = this
        if (asset.isNative()) { //for XLM total amount should include fee reserves
            const amount = this.sellingAmount + feesReserve * 10000000
            //check available balance
            if (toStroops(findTrustline(sourceAccount, asset).balance) < amount)
                throw new Error('Insufficient XLM balance for selling amount + potential trading fees')
            //only create account is required for asset transfer
            ops.push(Operation.createAccount({
                destination: this.mediatorAddress,
                startingBalance: fromStroops(amount)
            }))
        } else {
            //check available XLM balance
            if (findTrustline(sourceAccount, Asset.native()).balance < feesReserve)
                throw new Error('Insufficient XLM balance for potential trading fees')
            //create mediator account
            ops.push(Operation.createAccount({
                destination: this.mediatorAddress,
                startingBalance: feesReserve // for tx fees
            }))
            //check available XLM balance
            const sellingTrustline = findTrustline(sourceAccount, asset)
            if (!sellingTrustline || toStroops(sellingTrustline.balance) < sellingAmount)
                throw new Error('Insufficient selling asset balance')
            //create trustline for selling asset
            ops.push(Operation.changeTrust({
                source: this.mediatorAddress,
                asset
            }))
            //transfer tokens to sell
            ops.push(Operation.payment({
                asset,
                destination: this.mediatorAddress,
                amount: fromStroops(this.sellingAmount)
            }))
        }
        ops.push(Operation.endSponsoringFutureReserves({}))
        await this.buildAndSend(sourceAccount, ops, 'StellarBroker mediator acc')
        //the account is ready to trade
        this.isReady = true
    }

    /**
     * @param {string} accountAddress
     * @param {string} mergeDestination
     */
    async dispose(accountAddress, mergeDestination) {
        //load account
        const account = await loadAccount(accountAddress)
        if (!account)
            throw new Error('Mediator account doesn\'t exist on the ledger')
        const ops = []
        //remove trustlines for each account balance
        for (const balance of account.balances) {
            if (balance.asset_type === 'native')
                continue //skip XLM trustline - merge will handle the transfer
            const asset = convertToStellarAsset(balance)
            //transfer remaining balance to the source account
            if (balance.balance > 0) {
                ops.push(Operation.payment({
                    asset,
                    destination: mergeDestination,
                    amount: balance.balance
                }))
            }
            //remove trustline
            ops.push(Operation.changeTrust({
                asset,
                limit: '0'
            }))
        }
        //merge
        ops.push(Operation.accountMerge({
            destination: mergeDestination
        }))
        await this.buildAndSend(account, ops)
        //disposed
        this.isReady = false
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
        //build tx and sign it on behalf of the mediator account
        let tx = builder.build()
        tx.sign(this.mediator)
        //request init transaction signature from the client
        tx = this.authorization.authorize(tx)
        //execute the tx
        const horizon = createHorizon()
        const res = await horizon.submitTransaction(tx, {skipMemoRequiredCheck: true})
        if (!res.successful)
            throw new Error('Failed to create mediator account')
    }
}

/**
 * @param {string} address
 * @return {Promise<AccountResponse>}
 */
async function loadAccount(address) {
    try {
        return createHorizon().loadAccount(address)
    } catch (e) {
        console.error(e)
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

function createHorizon() {
    return new Horizon.Server('https://horizon.stellar.org')
}

module.exports = Mediator