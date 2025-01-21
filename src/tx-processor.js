import {hash, Keypair, nativeToScVal, StrKey, TransactionBuilder, xdr} from '@stellar/stellar-sdk'
import errors from './errors.js'

/**
 * @param {StellarBrokerClient} client
 * @param {{xdr: string, hash: string, networkFee: string, [confirmed]: boolean}} txRequest
 * @return {Promise<string>}
 */
export async function processTxRequest(client, txRequest) {
    //parse incoming transaction
    let tx
    try {
        tx = TransactionBuilder.fromXDR(txRequest.xdr, client.network)
    } catch (e) {
        throw errors.invalidSwapTx()
    }
    //check that transaction is correct
    if (!validateTransaction(client, tx))
        throw errors.invalidSwapTx()
    //if transaction has not been authorized yet by the channel account
    const isSorobanTx = tx.operations[0].auth?.length > 0
    if (isSorobanTx) {
        //send tx back to the server
        if (!tx.signatures.length) {
            //sign auth
            await authorizeInvocation(client, tx)
            tx = await signTx(client, tx)
            return tx.toXDR()//wait for the signed tx from the server to wrap it with fee bump tx
        }
    } else {
        //sign transaction
        tx = await signTx(client, tx)
    }
    //wrap with fee bump
    let wrapped = TransactionBuilder.buildFeeBumpTransaction(client.trader, txRequest.networkFee, tx, client.network)
    //sign fee bump wrapper tx
    wrapped = await signTx(client, wrapped)
    //respond with signed transaction
    return wrapped.toXDR()
}

/**
 * @param {StellarBrokerClient} client
 * @param {TransactionI} tx
 * @return {Promise<TransactionI>}
 * @private
 */
async function authorizeInvocation(client, tx) {
    //from https://github.com/stellar/js-stellar-base/blob/e3d6fc3351e7d242b374c7c6057668366364a279/src/auth.js#L97
    const auth = tx.operations[0].auth[0]
    /** @type {xdr.SorobanAddressCredentials} */
    const addrAuth = auth.credentials().address()
    addrAuth.signatureExpirationLedger(tx.ledgerBounds.maxLedger + 1)

    const networkId = hash(Buffer.from(tx.networkPassphrase))
    const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
        new xdr.HashIdPreimageSorobanAuthorization({
            networkId,
            nonce: addrAuth.nonce(),
            invocation: auth.rootInvocation(),
            signatureExpirationLedger: addrAuth.signatureExpirationLedger()
        })
    )
    const payload = hash(preimage.toXDR())
    const signature = await client.authorization.authorize(payload)
    const publicKey = StrKey.encodeEd25519PublicKey(addrAuth.address().accountId().value())
    const sigScVal = nativeToScVal(
        {
            public_key: StrKey.decodeEd25519PublicKey(publicKey),
            signature
        },
        {
            type: {
                public_key: ['symbol', null],
                signature: ['symbol', null]
            }
        }
    )

    addrAuth.signature(xdr.ScVal.scvVec([sigScVal]))
}

/**
 * @param {StellarBrokerClient} client
 * @param {TransactionI} tx
 * @return {Promise<TransactionI>}
 * @private
 */
function signTx(client, tx) {
    return client.authorization.authorize(tx)
        .then(tx => {
            if (typeof tx === 'string') { //normalize response
                tx = TransactionBuilder.fromXDR(tx, client.network)
            }
            if (!tx || tx.signatures?.length < 1)
                throw new Error(`Transaction was not signed`)
            return tx
        })
        .catch(e => {
            console.error(e)
            throw errors.failedToSignTx()
        })
}

/**
 * @param {StellarBrokerClient} client
 * @param {Transaction} tx
 * @throws {StellarBrokerError} Invalid swap transaction received
 */
function validateTransaction(client, tx) {
    /*if (!(tx instanceof FeeBumpTransaction))
        return false
    const {innerTransaction} = tx
    if (tx.feeSource !== this.source)
        return false*/
    for (let swap of tx.operations) {
        if (swap.type === 'invokeHostFunction')
            continue //TODO: add additional validation
        if (swap.type !== 'pathPaymentStrictSend' && swap.type !== 'pathPaymentStrictReceive')
            return false
        const isFee = swap.destination !== client.trader
        if (isFee) {
            if (swap.type !== 'pathPaymentStrictSend')
                return false
            if ((swap.source && swap.source !== client.trader))
                return false
        } else {
            if ((swap.source && swap.source !== swap.destination) || swap.destination !== client.trader)
                return false
        }
    }
    //TODO: check assets and amounts
    return true
}