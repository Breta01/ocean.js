import { TestContractHandler } from '../TestContractHandler'
import { DataTokens } from '../../src/datatokens/Datatokens'
import { Ocean } from '../../src/ocean/Ocean'
import config from './config'
import { assert } from 'console'

// import Accounts from "../../src/ocean/Account"

const Web3 = require('web3')
const web3 = new Web3('http://127.0.0.1:8545')
const factory = require('@oceanprotocol/contracts/artifacts/development/Factory.json')
const datatokensTemplate = require('@oceanprotocol/contracts/artifacts/development/DataTokenTemplate.json')

describe('Marketplace flow', () => {
    let owner
    let bob
    let ddo
    let alice
    let asset
    let accounts
    let marketplace
    let marketOcean
    let contracts
    let datatoken
    let tokenAddress
    let transactionId
    let service1
    let service2

    let ocean

    const marketplaceAllowance = 20
    const tokenAmount = 100
    const transferAmount = 2
    const blob = 'http://localhost:8030/api/v1/provider/services'

    describe('#test', () => {
        it('Initialize Ocean contracts v3', async () => {
            contracts = new TestContractHandler(
                factory.abi,
                datatokensTemplate.abi,
                datatokensTemplate.bytecode,
                factory.bytecode,
                web3
            )

            ocean = await Ocean.getInstance(config)

            owner = (await ocean.accounts.list())[0]
            alice = (await ocean.accounts.list())[1]
            bob = (await ocean.accounts.list())[2]
            marketplace = (await ocean.accounts.list())[3]

            await contracts.deployContracts(owner.getId())
        })

        it('Alice publishes a datatoken contract', async () => {
            datatoken = new DataTokens(
                contracts.factoryAddress,
                factory.abi,
                datatokensTemplate.abi,
                web3
            )

            tokenAddress = await datatoken.create(blob, alice.getId())
        })

        it('Generates metadata', async () => {
            asset = {
                main: {
                    type: 'dataset',
                    name: 'test-dataset',
                    dateCreated: new Date(Date.now()).toISOString().split('.')[0] + 'Z', // remove milliseconds
                    author: 'oceanprotocol-team',
                    license: 'MIT',
                    files: [
                        {
                            url:
                                'https://raw.githubusercontent.com/tbertinmahieux/MSongsDB/master/Tasks_Demos/CoverSongs/shs_dataset_test.txt',
                            checksum: 'efb2c764274b745f5fc37f97c6b0e761',
                            contentLength: '4535431',
                            contentType: 'text/csv',
                            encoding: 'UTF-8',
                            compression: 'zip'
                        }
                    ]
                }
            }
        })

        it('Alice publishes a dataset', async () => {
            ddo = await ocean.assets.create(asset, alice, [], tokenAddress)
            assert(ddo.dataToken === tokenAddress)
        })

        it('Alice mints 100 tokens', async () => {
            await datatoken.mint(tokenAddress, alice.getId(), tokenAmount)
        })

        it('Alice allows marketplace to sell her datatokens', async () => {
            await datatoken
                .approve(
                    tokenAddress,
                    marketplace.getId(),
                    marketplaceAllowance,
                    alice.getId()
                )
                .then(async () => {
                    const allowance = await datatoken.allowance(
                        tokenAddress,
                        alice.getId(),
                        marketplace.getId()
                    )
                    assert(allowance.toString() === marketplaceAllowance.toString())
                })
        })

        it('Marketplace withdraw Alice tokens from allowance', async () => {
            const allowance = await datatoken.allowance(
                tokenAddress,
                alice.getId(),
                marketplace.getId()
            )
            await datatoken
                .transferFrom(tokenAddress, alice.getId(), allowance, marketplace.getId())
                .then(async () => {
                    const marketplaceBalance = await datatoken.balance(
                        tokenAddress,
                        marketplace.getId()
                    )
                    assert(
                        marketplaceBalance.toString() === marketplaceAllowance.toString()
                    )
                })
        })
        it('Marketplace should resolve asset using DID', async () => {
            assert(ddo, await ocean.assets.resolve(ddo.id))
        })

        it('Marketplace posts asset for sale', async () => {
            // const downloadService = await ocean.assets.getService(ddo.id, 'download')
        })

        it('Bob gets datatokens', async () => {
            const ts = await datatoken.transfer(
                tokenAddress,
                bob.getId(),
                transferAmount,
                alice.getId()
            )
            transactionId = ts.transactionHash
        })

        // it('Bob consumes asset 1', async () => {
        //     // const config = new Config()
        //     const ocean = await Ocean.getInstance(config)
        //     await ocean.assets.download(asset.did, service1.index, bob, '~/my-datasets')
        // })

        // it('Bob consumes asset 2', async () => {
        //     // TODO
        // })
    })
})
