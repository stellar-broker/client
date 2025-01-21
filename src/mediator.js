import {Asset, Keypair, Memo, Operation, TransactionBuilder, Horizon, Networks, StrKey} from '@stellar/stellar-sdk'
import {fromStroops, toStroops} from './stroops.js'
import {convertToStellarAsset} from './asset.js'
import {processAuthorization} from './authorization.js'

class Mediator {
    /**
     * Create a trader mediator account instance for a given source account
     * @param {string} source - Creator account address
     * @param {string|Asset} sellingAsset - Asset identifier to sell
     * @param {string} sellingAmount - Asset amount to sell
     * @param {Keypair|ClientAuthorizationCallback} authorization - Authorization
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
        this.authorization = processAuthorization(authorization)
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
     * @type {Keypair|ClientAuthorizationCallback}
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
        const builder = createTxBuilder(sourceAccount)
        builder.addMemo(Memo.text('StellarBroker mediator acc'))
        //create new random keypair for the trade
        this.mediator = Keypair.random()
        this.mediatorAddress = this.mediator.publicKey()
        const {asset} = this
        builder.addOperation(Operation.beginSponsoringFutureReserves({
            sponsoredId: this.mediatorAddress
        }))
        if (asset.isNative()) {
            const amount = this.sellingAmount + feesReserve * 10000000
            if (toStroops(findTrustline(sourceAccount, asset).balance) < amount)
                throw new Error('Insufficient XLM balance for selling amount + potential trading fees')
            builder.addOperation(Operation.createAccount({
                destination: this.mediatorAddress,
                startingBalance: fromStroops(amount)
            }))
        } else {
            if (findTrustline(sourceAccount, Asset.native()).balance < feesReserve)
                throw new Error('Insufficient XLM balance for potential trading fees')
            builder.addOperation(Operation.createAccount({
                destination: this.mediatorAddress,
                startingBalance: feesReserve // for tx fees
            }))
            const sellingTrustline = findTrustline(sourceAccount, asset)
            if (!sellingTrustline || toStroops(sellingTrustline.balance) < sellingAmount)
                throw new Error('Insufficient selling asset balance')
            builder.addOperation(Operation.changeTrust({
                source: this.mediatorAddress,
                asset
            }))
            builder.addOperation(Operation.payment({
                asset,
                destination: this.mediatorAddress,
                amount: fromStroops(this.sellingAmount)
            }))
        }
        builder.addOperation(Operation.endSponsoringFutureReserves({}))
        const tx = builder.build()
        tx.sign(this.mediator)
        //request init transaction signature from the client
        await session.authorizeMediator(this.mediatorAddress, tx.toXDR())
        await submit()
        this.isReady = true
    }

    /**
     * @param {string} accountAddress
     * @param {string} mergeDestination
     */
    async dispose(accountAddress, mergeDestination) {
        const account = await loadAccount(accountAddress)
        if (!account)
            throw new Error('Mediator account doesn\'t exist on the ledger')
        const builder = createTxBuilder(accountAddress)

        for (const balance of account.balances) {
            if (balance.asset_type === 'native')
                continue
            const asset = convertToStellarAsset(balance)
            if (balance.balance > 0) { // if src balance left
                builder.addOperation(Operation.payment({
                    asset,
                    destination: this.source,
                    amount: balance.balance
                }))
            }
            builder.addOperation(Operation.changeTrust({
                asset,
                limit: '0'
            }))
        }

        builder.addOperation(Operation.accountMerge({
            destination: mergeDestination
        }))
    }
}

//additional XLM amount to cover tx fees
const feesReserve = '2'

function createTxBuilder(account) {
    const builder = new TransactionBuilder(account, {
        fee: '1000000',
        networkPassphrase: Networks.PUBLIC
    })
    return builder
}

async function loadAccount(address) {
    try {
        return createHorizon().loadAccount(address)
    } catch (e) {
        console.error(e)
    }
}

/**
 * @param {AccountResponse} account
 * @param {Asset} sellingAsset
 * @param {string} sellingAmount
 * @return {BalanceLine}
 */
function verifySourceAccount(account, sellingAsset, sellingAmount) {


    const sellingAssetBalance = findTrustline(account, this.sellingAsset)
    if (sellingAssetBalance) {

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

async function submit(tx) {
    const horizon = createHorizon()
    const res = await horizon.submitTransaction(tx, {skipMemoRequiredCheck: true})
    if (!res.successful)
        throw new Error('Failed to create mediator account')
}

module.exports = Mediator