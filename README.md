# @stellar-broker/client

## Installation

```
npm i @stellar-broker/client
```

## Usage

### Interactive Sessions

Using an interactive session is the preferred way for the majority of integrations.
A client connects to the router server and maintains the connection open, receiving price quote updates and other 
notifications from the server without delays. Trading, retries, and results confirmations get processed in the
background.

```js
import StellarBrokerClient from '@stellar-broker/client'

//create client instance
const client = new StellarBrokerClient({partnerKey: '<your_partner_key>'})

//subscribe to the quote notifications
client.on('quote', e => {
    console.log('Received route quote from the server', e.quote)
    /*{
      "status": "success",
      "sellingAsset": "USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "buyingAsset": "XLM",
      "slippageTolerance": 0.5,
      "direction": "strict_send",
      "directTrade": {
          "selling": "10",
          "buying": "100.23505",
          "path": []
      },
      "sellingAmount": "10",
      "estimatedBuyingAmount": "100.688121",
      "ts": "2024-08-13T23:13:21.275Z"
    }*/
})

client.on('paused', e => {
    console.log('Quotation paused due to inactivity. Call `quote` method to resume.')
})

client.on('finished', e => {
    console.log('Trade finished', e.result)
    /*{
      "status": "success",
      "sold": "10",
      "bought": "100.6704597"
    }*/
})

client.on('progress', e => {
    console.log('Progress', e.status)
    /*{
      "sold": "10",
      "bought": "100.6704597"
    }*/
})

client.on('error', e => {
    console.warn('StellarBroker error', e.error)
})

//connect
client.connect() //only once
    .then(() => console.log('StellarBroker connected'))
    .catch(e => console.error(e))

//request a price quote
client.quote({
    sellingAsset: 'xlm',
    buyingAsset: 'USD-GDK2GNB4Q6FKNW2GNJIQFARI4RMSHV5DN5G4BBXX2F24RT5I4QT7TWZ7',
    sellingAmount: '1000', //1000.0000000 XLM
    slippageTolerance: 0.02 //2%
})

//once the quote received from the server, we can confirm the quote
async function signTx(payload) { //async signing callback - implement custom logic here
    const kp = Keypair.fromSecret('<account_secret>')
    if (payload.sign) { //sign transaction
        payload.sign(kp)
        return payload
    } 
    //it's authorization payload
    return kp.sign(payload)
}
client.confirmQuote('<account_address>', signTx) //provide trader account address

//trade can be interrupted from the client by calling
client.stop()

//cleanup resources and close connection once the trading has been finished
client.close()
```

### Swap Estimate

Swap estimates may be handy in scenarios when a client has no intention to trade or receive price quote updates,
and just wants to get a single price quote instead.

```js
import {estimateSwap} from '@stellar-broker/client'

estimateSwap({
    sellingAsset: 'xlm',
    buyingAsset: 'USD-GDK2GNB4Q6FKNW2GNJIQFARI4RMSHV5DN5G4BBXX2F24RT5I4QT7TWZ7',
    sellingAmount: '1000', 
    slippageTolerance: 0.02 //2%
})
```

### Delegated Signing and Multisig

StellarBroker trading sessions rely on fast transactions signing in order to immediately react on market changes.
In scenarios when a client app cannot sign transactions directly or requires multisig aggregation, it's still possible
to utilize StellarBroker using a mediator account. 

Mediator flow implies creation of a temporary auxiliary account that will hold tokens until the swap process is executed
in full, then transfers all funds back to the source account and gets merged into it, releasing temporary blocked XLM
funds.

This package contains a reference implementation of such mediator account, but it's up to developers whether to use it
directly or create alternative logic based on it.


```js
import {Mediator} from '@stellar-broker/client'

const sellingAsset = 'XLM'
const buyingAsset = 'AQUA-GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA'
const sellingAmount = '10'

//once the quote received from the server, we can confirm the quote
async function signTx(tx) { //async signing callback - implement custom logic here
    const kp = Keypair.fromSecret('<account_secret>')
    tx.sign(kp)
    return tx
}

//fabric for meditor account creation
const mediator = new Mediator(source, sellingAsset, buyingAsset, sellingAmount, signTx)

//create new mediator account
const mediatorSecret = await mediator.init()
console.log('Created mediator account ' + Keypair.fromSecret(mediatorSecret).publicKey())

//use it for trading, and dispose once finished -- all funds and XLM reserves will be returned to the source account
await mediator.dispose()
console.log('Mediator account disposed')

//if the user left the session in the process or there were connection problems,
//funds from previously created mediator accounts can be recovered like this
if (mediator.hasObsoleteMediators) {
    await mediator.disposeObsoleteMediators()
}
```