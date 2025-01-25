import {Keypair, StrKey} from '@stellar/stellar-sdk'
import {Mediator} from '../src/index.js'

describe('mediator', () => {
    beforeAll(() => {
        global.localStorage = new LocalStorageShim()
    })

    afterAll(() => {
        global.localStorage = undefined
    })

    afterEach(() => {
        global.localStorage.clear()
        HorizonShim.clear()
    })

    const xlm = 'XLM'
    const aqua = 'AQUA-GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA'
    const usdc = 'USDC-GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA'

    test('init & dispose XLM->AQUA', async () => {
        const sourceKeypair = Keypair.random()
        const source = sourceKeypair.publicKey()
        HorizonShim.setAccountInfo(source, [
            balanceFromAsset(xlm, '5'),
            balanceFromAsset(aqua, '0')
        ])

        const mediator = new Mediator(source, xlm, aqua, '10', sourceKeypair.secret())
        mediator.createHorizon = () => new HorizonShim()

        //should have enough XLM to sell + cover fees
        await expect(async () => await mediator.init()).rejects.toThrow(/Insufficient XLM balance/)

        HorizonShim.setAccountInfo(source, [
            balanceFromAsset(xlm, '11'),
            balanceFromAsset(aqua, '0')
        ])
        await expect(async () => await mediator.init()).rejects.toThrow(/Insufficient XLM balance/)

        HorizonShim.setAccountInfo(source, [
            balanceFromAsset(xlm, '100'),
            balanceFromAsset(aqua, '0')
        ])

        await mediator.init()
        let tx = HorizonShim.getLastTx()
        expect(tx.source).toEqual(source)
        expect(tx.operations).toEqual([
            {
                source,
                type: 'createAccount',
                destination: mediator.mediatorAddress,
                startingBalance: '12.0000000'
            },
            {
                source: mediator.mediatorAddress,
                type: 'setOptions',
                masterWeight: 1,
                lowThreshold: 1,
                medThreshold: 1,
                highThreshold: 1,
                homeDomain: 'mediator.stellar.broker',
                signer: {
                    ed25519PublicKey: source,
                    weight: 1
                }
            },
            {
                source: mediator.mediatorAddress,
                type: 'changeTrust',
                line: lineFromAsset(aqua),
                limit: '922337203685.4775807'
            }
        ])
        expect(localStorage[formatLsKey(mediator.mediatorAddress)]).toEqual(source)

        //mediator account should exist on chain
        await expect(async () => await mediator.dispose()).rejects.toThrow(/doesn't exist on the ledger/)

        HorizonShim.setAccountInfo(mediator.mediatorAddress, [
            balanceFromAsset(xlm, '1'),
            balanceFromAsset(aqua, '1000')
        ])
        //mediator should have proper signers
        await expect(async () => await mediator.dispose()).rejects.toThrow(/is not a mediator account for/)

        HorizonShim.setAccountInfo(mediator.mediatorAddress, [
            balanceFromAsset(xlm, '1'),
            balanceFromAsset(aqua, '1000')
        ], [{key: source, weight: 1}])
        await mediator.dispose()

        tx = HorizonShim.getLastTx()

        expect(tx.source).toEqual(mediator.mediatorAddress)
        expect(tx.operations).toEqual([
            {
                source: mediator.mediatorAddress,
                type: 'payment',
                destination: source,
                asset: lineFromAsset(aqua),
                amount: '1000.0000000'
            },
            {
                source: mediator.mediatorAddress,
                type: 'changeTrust',
                line: lineFromAsset(aqua),
                limit: '0.0000000'
            },
            {
                source: mediator.mediatorAddress,
                type: 'accountMerge',
                destination: source
            }
        ])

        expect(localStorage[formatLsKey(mediator.mediatorAddress)]).toEqual(undefined)
    })

    test('init & dispose USDC->AQUA', async () => {
        const sourceKeypair = Keypair.random()
        const source = sourceKeypair.publicKey()
        HorizonShim.setAccountInfo(source, [
            balanceFromAsset(xlm, '10'),
            balanceFromAsset(aqua, '0')
        ])

        const mediator = new Mediator(source, usdc, aqua, '10', sourceKeypair.secret())
        mediator.createHorizon = () => new HorizonShim()

        //should have enough tokens to sell
        await expect(async () => await mediator.init()).rejects.toThrow(/Insufficient selling asset balance/)

        HorizonShim.setAccountInfo(source, [
            balanceFromAsset(xlm, '10'),
            balanceFromAsset(usdc, '10'),
            balanceFromAsset(aqua, '0')
        ])
        await mediator.init()
        let tx = HorizonShim.getLastTx()
        expect(tx.source).toEqual(source)
        expect(tx.operations).toEqual([
            {
                source,
                type: 'createAccount',
                destination: mediator.mediatorAddress,
                startingBalance: '2.0000000'
            },
            {
                source: mediator.mediatorAddress,
                type: 'changeTrust',
                line: lineFromAsset(usdc),
                limit: '922337203685.4775807'
            },
            {
                source: source,
                type: 'payment',
                destination: mediator.mediatorAddress,
                asset: lineFromAsset(usdc),
                amount: '10.0000000'
            },
            {
                source: mediator.mediatorAddress,
                type: 'setOptions',
                masterWeight: 1,
                lowThreshold: 1,
                medThreshold: 1,
                highThreshold: 1,
                homeDomain: 'mediator.stellar.broker',
                signer: {
                    ed25519PublicKey: source,
                    weight: 1
                }
            },
            {
                source: mediator.mediatorAddress,
                type: 'changeTrust',
                line: lineFromAsset(aqua),
                limit: '922337203685.4775807'
            }
        ])
        expect(localStorage[formatLsKey(mediator.mediatorAddress)]).toEqual(source)

        HorizonShim.setAccountInfo(mediator.mediatorAddress, [
            balanceFromAsset(xlm, '1'),
            balanceFromAsset(usdc, '0'),
            balanceFromAsset(aqua, '1000')
        ], [{key: source, weight: 1}])
        await mediator.dispose()

        tx = HorizonShim.getLastTx()

        expect(tx.source).toEqual(mediator.mediatorAddress)
        expect(tx.operations).toEqual([
            {
                source: mediator.mediatorAddress,
                type: 'changeTrust',
                line: lineFromAsset(usdc),
                limit: '0.0000000'
            },
            {
                source: mediator.mediatorAddress,
                type: 'payment',
                destination: source,
                asset: lineFromAsset(aqua),
                amount: '1000.0000000'
            },
            {
                source: mediator.mediatorAddress,
                type: 'changeTrust',
                line: lineFromAsset(aqua),
                limit: '0.0000000'
            },
            {
                source: mediator.mediatorAddress,
                type: 'accountMerge',
                destination: source
            }
        ])

        expect(localStorage[formatLsKey(mediator.mediatorAddress)]).toEqual(undefined)
    })

    test('dispose obsolete', async () => {
        const sourceKeypair = Keypair.random()
        const source = sourceKeypair.publicKey()
        HorizonShim.setAccountInfo(source, [
            balanceFromAsset(xlm, '10'),
            balanceFromAsset(usdc, '10'),
            balanceFromAsset(aqua, '0')
        ])

        const mediator = new Mediator(source, usdc, aqua, '10', sourceKeypair.secret())
        mediator.createHorizon = () => new HorizonShim()

        expect(mediator.hasObsoleteMediators).toEqual(false)

        const obsoleteMediators = [Keypair.random().publicKey(), Keypair.random().publicKey()]
        for (let i = 0; i < obsoleteMediators.length; i++) {
            const obsolete = obsoleteMediators[i]
            localStorage.setItem(formatLsKey(obsolete), source)

            HorizonShim.setAccountInfo(obsolete, [
                balanceFromAsset(xlm, '1'),
                balanceFromAsset(aqua, '1000')
            ], [{key: source, weight: 1}])
        }

        expect(mediator.hasObsoleteMediators).toEqual(true)
        expect(HorizonShim.txCount).toEqual(0)

        await mediator.disposeObsoleteMediators()

        expect(mediator.hasObsoleteMediators).toEqual(false)
        expect(HorizonShim.txCount).toEqual(2)
        expect(global.localStorage.count).toEqual(0)
    })
})

function balanceFromAsset(asset, balance) {
    if (asset === 'XLM')
        return {asset_type: 'native', balance}
    const [asset_code, asset_issuer] = asset.split('-')
    return {asset_type: 'credit_alphanum4', asset_code, asset_issuer, balance}
}

function lineFromAsset(asset) {
    const [code, issuer] = asset.split('-')
    return {code, issuer}
}

function formatLsKey(address) {
    return 'msb_' + address
}

class LocalStorageShim {
    setItem(key, value) {
        this[key] = value
    }

    getItem(key) {
        return this[key]
    }

    removeItem(key) {
        delete this[key]
    }

    clear() {
        for (let key of Object.keys(this)) {
            this.removeItem(key)
        }
    }

    get count() {
        return Object.keys(this).length
    }
}

class HorizonShim {
    async submitTransaction(tx) {
        this.constructor.txHistory.push(tx)
        return {successful: true}
    }

    async loadAccount(address) {
        return this.constructor.accounts[address]
    }

    /**
     * @private
     */
    static accounts = {}

    /**
     * @private
     */
    static txHistory = []

    /**
     * @param {string} address
     * @param {BalanceLine[]} balances
     * @param {AccountSigner[]} signers
     */
    static setAccountInfo(address, balances, signers = []) {
        this.accounts[address] = {
            id: address,
            sequence: '1',
            balances,
            signers,
            accountId() {
                return address
            },
            sequenceNumber() {
                return '1'
            },
            incrementSequenceNumber() {
                this.sequence = (1 + this.sequence).toString()
            }
        }
    }

    /**
     * @return {Transaction}
     */
    static getLastTx() {
        return this.txHistory[this.txHistory.length - 1]
    }

    static get txCount() {
        return this.txHistory.length
    }

    static clear() {
        this.txHistory = []
    }
}
