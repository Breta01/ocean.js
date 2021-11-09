import defaultFixedRateExchangeABI from '@oceanprotocol/contracts/artifacts/contracts/pools/fixedRate/FixedRateExchange.sol/FixedRateExchange.json'
import defaultERC20ABI from '@oceanprotocol/contracts/artifacts/contracts/templates/ERC20Template.sol/ERC20Template.json'
import BigNumber from 'bignumber.js'
import { TransactionReceipt } from 'web3-core'
import { Contract, EventData } from 'web3-eth-contract'
import { AbiItem } from 'web3-utils/types'
import Web3 from 'web3'
import { LoggerInstance, getFairGasPrice } from '../../utils'

const MAX_AWAIT_PROMISES = 10

export interface FixedPriceExchange {
  active: boolean
  exchangeOwner: string
  dataToken: string
  baseToken: string
  fixedRate: string
  dtDecimals: string
  btDecimals: string
  dtBalance: string
  btBalance: string
  dtSupply: string
  btSupply: string
  withMint: boolean
  allowedSwapper: string
  exchangeID?: string
}

export interface FeesInfo {
  opfFee: string
  marketFee: string
  marketFeeCollector: string
  marketFeeAvailable: string
  oceanFeeAvailable: string
  exchangeID: string
}
export interface FixedPriceSwap {
  exchangeID: string
  caller: string
  baseTokenAmount: string
  dataTokenAmount: string
}

export enum FixedRateCreateProgressStep {
  CreatingExchange,
  ApprovingDatatoken
}

export class FixedRateExchange {
  public GASLIMIT_DEFAULT = 1000000
  /** Ocean related functions */
  public oceanAddress: string = null
  public fixedRateAddress: string
  public fixedRateExchangeABI: AbiItem | AbiItem[]
  public fixedRateContract: Contract
  public web3: Web3
  public contract: Contract = null

  public startBlock: number
  public ssABI: AbiItem | AbiItem[]

  /**
   * Instantiate FixedRateExchange
   * @param {any} web3
   * @param {any} fixedRateExchangeABI
   */
  constructor(
    web3: Web3,
    fixedRateAddress: string,
    fixedRateExchangeABI: AbiItem | AbiItem[] = null,
    oceanAddress: string = null,
    startBlock?: number
  ) {
    this.web3 = web3

    if (startBlock) this.startBlock = startBlock
    else this.startBlock = 0
    this.fixedRateExchangeABI =
      fixedRateExchangeABI || (defaultFixedRateExchangeABI.abi as AbiItem[])
    this.oceanAddress = oceanAddress
    this.fixedRateAddress = fixedRateAddress
    this.contract = new this.web3.eth.Contract(
      this.fixedRateExchangeABI,
      this.fixedRateAddress
    )
  }

  async amountToUnits(token: string, amount: string): Promise<string> {
    let decimals = 18
    const tokenContract = new this.web3.eth.Contract(
      defaultERC20ABI.abi as AbiItem[],
      token
    )

    try {
      decimals = await tokenContract.methods.decimals().call()
    } catch (e) {
      LoggerInstance.error('ERROR: FAILED TO CALL DECIMALS(), USING 18')
    }

    const amountFormatted = new BigNumber(parseInt(amount) * 10 ** decimals)

    return amountFormatted.toString()
  }

  async unitsToAmount(token: string, amount: string): Promise<string> {
    let decimals = 18
    const tokenContract = new this.web3.eth.Contract(
      defaultERC20ABI.abi as AbiItem[],
      token
    )
    try {
      decimals = await tokenContract.methods.decimals().call()
    } catch (e) {
      LoggerInstance.error('ERROR: FAILED TO CALL DECIMALS(), USING 18')
    }

    const amountFormatted = new BigNumber(parseInt(amount) / 10 ** decimals)

    return amountFormatted.toString()
  }

  /**
   * Creates unique exchange identifier.
   * @param {String} dataToken Data Token Contract Address
   * @param {String} owner Owner of the exchange
   * @return {Promise<string>} exchangeId
   */
  public async generateExchangeId(
    basetoken: string,
    dataToken: string,
    owner: string
  ): Promise<string> {
    const exchangeId = await this.contract.methods
      .generateExchangeId(basetoken, dataToken, owner)
      .call()
    return exchangeId
  }

  /**
   * Estimate gas cost for buyDT
   * @param {String} account
   * @param {String} dtAmount datatoken amount we want to buy
   * @param {String} datatokenAddress datatokenAddress
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estBuyDT(
    account: string,
    datatokenAddress: string,
    dtAmount: string,
    maxBasetokenAmount: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .buyDT(datatokenAddress, dtAmount.toString(), maxBasetokenAmount.toString())
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Atomic swap
   * @param {String} exchangeId ExchangeId
   * @param {String} datatokenAmount Amount of Data Tokens
   * @param {String} maxBasetokenAmount max amount of basetoken we want to pay for dataTokenAmount
   * @param {String} address User address
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async buyDT(
    address: string,
    exchangeId: string,
    datatokenAmount: string,
    maxBasetokenAmount: string
  ): Promise<TransactionReceipt> {
    const dtAmountFormatted = await this.amountToUnits(
      (
        await this.getExchange(exchangeId)
      ).dataToken,
      datatokenAmount
    )
    const maxBtFormatted = await this.amountToUnits(
      (
        await this.getExchange(exchangeId)
      ).baseToken,
      maxBasetokenAmount
    )

    const estGas = await this.estBuyDT(
      address,
      exchangeId,
      dtAmountFormatted,
      maxBtFormatted
    )
    try {
      const trxReceipt = await this.contract.methods
        .buyDT(exchangeId, dtAmountFormatted, maxBtFormatted)
        .send({
          from: address,
          gas: estGas + 1,
          gasPrice: await getFairGasPrice(this.web3)
        })
      return trxReceipt
    } catch (e) {
      LoggerInstance.error(`ERROR: Failed to buy datatokens: ${e.message}`)
      return null
    }
  }

  /**
   * Estimate gas cost for sellDT
   * @param {String} account
   * @param {String} dtAmount datatoken amount we want to sell
   * @param {String} datatokenAddress datatokenAddress
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estSellDT(
    account: string,
    datatokenAddress: string,
    dtAmount: string,
    maxBasetokenAmount: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .sellDT(datatokenAddress, dtAmount, maxBasetokenAmount)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Atomic swap
   * @param {String} exchangeId ExchangeId
   * @param {String} datatokenAmount Amount of Data Tokens
   * @param {String} minBasetokenAmount min amount of basetoken we want to receive back
   * @param {String} address User address
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async sellDT(
    address: string,
    exchangeId: string,
    datatokenAmount: string,
    minBasetokenAmount: string
  ): Promise<TransactionReceipt> {
    const dtAmountFormatted = await this.amountToUnits(
      (
        await this.getExchange(exchangeId)
      ).dataToken,
      datatokenAmount
    )
    const minBtFormatted = await this.amountToUnits(
      (
        await this.getExchange(exchangeId)
      ).baseToken,
      minBasetokenAmount
    )
    const estGas = await this.estBuyDT(
      address,
      exchangeId,
      dtAmountFormatted,
      minBtFormatted
    )
    try {
      const trxReceipt = await this.contract.methods
        .sellDT(exchangeId, dtAmountFormatted, minBtFormatted)
        .send({
          from: address,
          gas: estGas + 1,
          gasPrice: await getFairGasPrice(this.web3)
        })
      return trxReceipt
    } catch (e) {
      LoggerInstance.error(`ERROR: Failed to sell datatokens: ${e.message}`)
      return null
    }
  }

  /**
   * Gets total number of exchanges
   * @param {String} exchangeId ExchangeId
   * @param {Number} dataTokenAmount Amount of Data Tokens
   * @return {Promise<Number>} no of available exchanges
   */
  public async getNumberOfExchanges(): Promise<number> {
    const numExchanges = await this.contract.methods.getNumberOfExchanges().call()
    return numExchanges
  }

  /**
   * Estimate gas cost for setRate
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {Number} newRate New rate
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estSetRate(
    account: string,
    exchangeId: string,
    newRate: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .setRate(exchangeId, newRate)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Set new rate
   * @param {String} exchangeId ExchangeId
   * @param {Number} newRate New rate
   * @param {String} address User account
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async setRate(
    address: string,
    exchangeId: string,
    newRate: string
  ): Promise<TransactionReceipt> {
    const estGas = await this.estSetRate(
      address,
      exchangeId,
      this.web3.utils.toWei(String(newRate))
    )
    const trxReceipt = await this.contract.methods
      .setRate(exchangeId, this.web3.utils.toWei(newRate))
      .send({
        from: address,
        gas: estGas + 1,
        gasPrice: await getFairGasPrice(this.web3)
      })
    return trxReceipt
  }

  /**
   * Estimate gas cost for setRate
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {String} newAllowedSwapper new allowed swapper address
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estSetAllowedSwapper(
    account: string,
    exchangeId: string,
    newAllowedSwapper: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .setRate(exchangeId, newAllowedSwapper)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Set new rate
   * @param {String} exchangeId ExchangeId
   * @param {String} newAllowedSwapper newAllowedSwapper (set address zero if we want to remove allowed swapper)
   * @param {String} address User account
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async setAllowedSwapper(
    address: string,
    exchangeId: string,
    newAllowedSwapper: string
  ): Promise<TransactionReceipt> {
    const estGas = await this.estSetAllowedSwapper(address, exchangeId, newAllowedSwapper)
    const trxReceipt = await this.contract.methods
      .setAllowedSwapper(exchangeId, newAllowedSwapper)
      .send({
        from: address,
        gas: estGas + 1,
        gasPrice: await getFairGasPrice(this.web3)
      })
    return trxReceipt
  }

  /**
   * Estimate gas cost for activate
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estActivate(
    account: string,
    exchangeId: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .toggleExchangeState(exchangeId)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Activate an exchange
   * @param {String} exchangeId ExchangeId
   * @param {String} address User address
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async activate(
    address: string,
    exchangeId: string
  ): Promise<TransactionReceipt> {
    const exchange = await this.getExchange(exchangeId)
    if (!exchange) return null
    if (exchange.active === true) return null
    const gasLimitDefault = this.GASLIMIT_DEFAULT

    const estGas = await this.estActivate(address, exchangeId)
    const trxReceipt = await this.contract.methods.toggleExchangeState(exchangeId).send({
      from: address,
      gas: estGas + 1,
      gasPrice: await getFairGasPrice(this.web3)
    })
    return trxReceipt
  }

  /**
   * Estimate gas cost for deactivate
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estDeactivate(
    account: string,
    exchangeId: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .toggleExchangeState(exchangeId)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Deactivate an exchange
   * @param {String} exchangeId ExchangeId
   * @param {String} address User address
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async deactivate(
    address: string,
    exchangeId: string
  ): Promise<TransactionReceipt> {
    const exchange = await this.getExchange(exchangeId)
    if (!exchange) return null
    if (exchange.active === false) return null

    const estGas = await this.estDeactivate(address, exchangeId)

    const trxReceipt = await this.contract.methods.toggleExchangeState(exchangeId).send({
      from: address,
      gas: estGas + 1,
      gasPrice: await getFairGasPrice(this.web3)
    })

    return trxReceipt
  }

  /**
   * Get Rate
   * @param {String} exchangeId ExchangeId
   * @return {Promise<string>} Rate (converted from wei)
   */
  public async getRate(exchangeId: string): Promise<string> {
    const weiRate = await this.contract.methods.getRate(exchangeId).call()
    return this.web3.utils.fromWei(weiRate)
  }

  /**
   * Get Datatoken Supply in the exchange
   * @param {String} exchangeId ExchangeId
   * @return {Promise<string>}  dt supply formatted
   */
  public async getDTSupply(exchangeId: string): Promise<string> {
    const dtSupply = await this.contract.methods.getDTSupply(exchangeId).call()
    return await this.unitsToAmount(
      (
        await this.getExchange(exchangeId)
      ).dataToken,
      dtSupply
    )
  }

  /**
   * Get Basetoken Supply in the exchange
   * @param {String} exchangeId ExchangeId
   * @return {Promise<string>} dt supply formatted
   */
  public async getBTSupply(exchangeId: string): Promise<string> {
    const btSupply = await this.contract.methods.getBTSupply(exchangeId).call()
    return await this.unitsToAmount(
      (
        await this.getExchange(exchangeId)
      ).baseToken,
      btSupply
    )
  }

  /**
   * Get Allower Swapper (if set this is the only account which can use this exchange, else is set at address(0))
   * @param {String} exchangeId ExchangeId
   * @return {Promise<string>} address of allowedSwapper
   */
  public async getAllowedSwapper(exchangeId: string): Promise<string> {
    return await this.contract.methods.getAllowedSwapper(exchangeId).call()
  }

  /**
   * getBTNeeded - returns amount in basetoken that user will pay for dataTokenAmount
   * @param {String} exchangeId ExchangeId
   * @param {Number} dataTokenAmount Amount of Data Tokens user wants to buy
   * @return {Promise<string>} Amount of basetoken needed for buying
   */
  public async getAmountBTIn(
    exchangeId: string,
    dataTokenAmount: string
  ): Promise<string> {
    const result = await this.contract.methods
      .calcBaseInGivenOutDT(
        exchangeId,
        await this.amountToUnits(
          (
            await this.getExchange(exchangeId)
          ).dataToken,
          dataTokenAmount
        )
      )
      .call()

    return await this.unitsToAmount(
      (
        await this.getExchange(exchangeId)
      ).baseToken,
      result.baseTokenAmount
    )
  }

  /**
   * getBTOut - returns amount in basetoken that user will receive for dataTokenAmount sold
   * @param {String} exchangeId ExchangeId
   * @param {Number} dataTokenAmount Amount of Data Tokens
   * @return {Promise<string>} Amount of basetokens user will receive
   */
  public async getAmountBTOut(
    exchangeId: string,
    dataTokenAmount: string
  ): Promise<string> {
    const result = await this.contract.methods
      .calcBaseOutGivenInDT(
        exchangeId,
        await this.amountToUnits(
          (
            await this.getExchange(exchangeId)
          ).dataToken,
          dataTokenAmount
        )
      )
      .call()

    return await this.unitsToAmount(
      (
        await this.getExchange(exchangeId)
      ).baseToken,
      result.baseTokenAmount
    )
  }

  /**
   * Get exchange details
   * @param {String} exchangeId ExchangeId
   * @return {Promise<FixedPricedExchange>} Exchange details
   */
  public async getExchange(exchangeId: string): Promise<FixedPriceExchange> {
    const result: FixedPriceExchange = await this.contract.methods
      .getExchange(exchangeId)
      .call()
    result.dtDecimals = result.dtDecimals.toString()
    result.btDecimals = result.btDecimals.toString()
    result.dtBalance = await this.unitsToAmount(result.dataToken, result.dtBalance)
    result.btBalance = await this.unitsToAmount(result.baseToken, result.btBalance)
    result.dtSupply = await this.unitsToAmount(result.dataToken, result.dtSupply)
    result.btSupply = await this.unitsToAmount(result.baseToken, result.btSupply)
    result.fixedRate = this.web3.utils.fromWei(result.fixedRate)
    result.exchangeID = exchangeId
    return result
  }

  /**
   * Get fee details for an exchange
   * @param {String} exchangeId ExchangeId
   * @return {Promise<FixedPricedExchange>} Exchange details
   */
  public async getFeesInfo(exchangeId: string): Promise<FeesInfo> {
    const result: FeesInfo = await this.contract.methods.getFeesInfo(exchangeId).call()
    result.opfFee = this.web3.utils.fromWei(result.opfFee.toString())
    result.marketFee = this.web3.utils.fromWei(result.marketFee.toString())

    result.marketFeeAvailable = await this.unitsToAmount(
      (
        await this.getExchange(exchangeId)
      ).baseToken,
      result.marketFeeAvailable
    )
    result.oceanFeeAvailable = await this.unitsToAmount(
      (
        await this.getExchange(exchangeId)
      ).baseToken,
      result.oceanFeeAvailable
    )

    result.exchangeID = exchangeId
    return result
  }

  /**
   * Get all exchanges
   * @param {String} exchangeId ExchangeId
   * @return {Promise<String[]>} Exchanges list
   */
  public async getExchanges(): Promise<string[]> {
    return await this.contract.methods.getExchanges().call()
  }

  /**
   * Check if an exchange is active
   * @param {String} exchangeId ExchangeId
   * @return {Promise<Boolean>} Result
   */
  public async isActive(exchangeId: string): Promise<boolean> {
    const result = await this.contract.methods.isActive(exchangeId).call()
    return result
  }

  /**
   * Estimate gas cost for activate
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estActivateMint(
    account: string,
    exchangeId: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .toggleMintState(exchangeId, true)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Activate minting option for fixed rate contract
   * @param {String} exchangeId ExchangeId
   * @param {String} address User address
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async activateMint(
    address: string,
    exchangeId: string
  ): Promise<TransactionReceipt> {
    const exchange = await this.getExchange(exchangeId)
    if (!exchange) return null
    if (exchange.withMint === true) return null
    const gasLimitDefault = this.GASLIMIT_DEFAULT

    const estGas = await this.estActivateMint(address, exchangeId)
    const trxReceipt = await this.contract.methods
      .toggleMintState(exchangeId, true)
      .send({
        from: address,
        gas: estGas + 1,
        gasPrice: await getFairGasPrice(this.web3)
      })
    return trxReceipt
  }

  /**
   * Estimate gas cost for deactivate
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estDeactivateMint(
    account: string,
    exchangeId: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .toggleMintState(exchangeId)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Deactivate minting for fixed rate
   * @param {String} exchangeId ExchangeId
   * @param {String} address User address
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async deactivateMint(
    address: string,
    exchangeId: string
  ): Promise<TransactionReceipt> {
    const exchange = await this.getExchange(exchangeId)
    if (!exchange) return null
    if (exchange.withMint === false) return null

    const estGas = await this.estDeactivate(address, exchangeId)

    const trxReceipt = await this.contract.methods
      .toggleMintState(exchangeId, false)
      .send({
        from: address,
        gas: estGas + 1,
        gasPrice: await getFairGasPrice(this.web3)
      })

    return trxReceipt
  }

  /**
   * Estimate gas cost for collectBT
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estCollectBT(
    account: string,
    exchangeId: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .collectBT(exchangeId)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Collect Basetokens in the contract (only exchange owner)
   * @param {String} exchangeId ExchangeId
   * @param {String} address User address
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async collectBT(
    address: string,
    exchangeId: string
  ): Promise<TransactionReceipt> {
    const exchange = await this.getExchange(exchangeId)
    if (!exchange) return null

    const estGas = await this.estCollectBT(address, exchangeId)
    const trxReceipt = await this.contract.methods.collectBT(exchangeId).send({
      from: address,
      gas: estGas + 1,
      gasPrice: await getFairGasPrice(this.web3)
    })
    return trxReceipt
  }

  /**
   * Estimate gas cost for collecDT
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estCollectDT(
    account: string,
    exchangeId: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .collectDT(exchangeId)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Collect datatokens in the contract (only exchange owner)
   * @param {String} exchangeId ExchangeId
   * @param {String} address User address
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async collectDT(
    address: string,
    exchangeId: string
  ): Promise<TransactionReceipt> {
    const exchange = await this.getExchange(exchangeId)
    if (!exchange) return null

    const estGas = await this.estCollectDT(address, exchangeId)
    const trxReceipt = await this.contract.methods.collectDT(exchangeId).send({
      from: address,
      gas: estGas + 1,
      gasPrice: await getFairGasPrice(this.web3)
    })
    return trxReceipt
  }

  /**
   * Estimate gas cost for collecMarketFee
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estCollectMarketFee(
    account: string,
    exchangeId: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .collectMarketFee(exchangeId)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Collect market fee and send it to marketFeeCollector (anyone can call it)
   * @param {String} exchangeId ExchangeId
   * @param {String} address User address
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async collectMarketFee(
    address: string,
    exchangeId: string
  ): Promise<TransactionReceipt> {
    const exchange = await this.getExchange(exchangeId)
    if (!exchange) return null

    const estGas = await this.estCollectMarketFee(address, exchangeId)
    const trxReceipt = await this.contract.methods.collectMarketFee(exchangeId).send({
      from: address,
      gas: estGas + 1,
      gasPrice: await getFairGasPrice(this.web3)
    })
    return trxReceipt
  }

  /**
   * Estimate gas cost for collectOceanFee
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estCollectOceanFee(
    account: string,
    exchangeId: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .collectMarketFee(exchangeId)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Collect ocean fee and send it to OPF collector (anyone can call it)
   * @param {String} exchangeId ExchangeId
   * @param {String} address User address
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async collectOceanFee(
    address: string,
    exchangeId: string
  ): Promise<TransactionReceipt> {
    const exchange = await this.getExchange(exchangeId)
    if (!exchange) return null

    const estGas = await this.estCollectOceanFee(address, exchangeId)
    const trxReceipt = await this.contract.methods.collectOceanFee(exchangeId).send({
      from: address,
      gas: estGas + 1,
      gasPrice: await getFairGasPrice(this.web3)
    })
    return trxReceipt
  }

  /**
   * Get OPF Collector of fixed rate contract
   * @return {String}
   */
  async getOPFCollector(): Promise<string> {
    let result = null
    try {
      result = await this.contract.methods.opfCollector().call()
    } catch (e) {
      LoggerInstance.error(`ERROR: Failed to get OPF Collector address: ${e.message}`)
    }
    return result
  }

  /**
   * Get Router address set in fixed rate contract
   * @return {String}
   */
  async getRouter(): Promise<string> {
    let result = null
    try {
      result = await this.contract.methods.router().call()
    } catch (e) {
      LoggerInstance.error(`ERROR: Failed to get Router address: ${e.message}`)
    }
    return result
  }

  /**
   * Get Exchange Owner given an exchangeId
   * @param {String} exchangeId ExchangeId
   * @return {String} return exchange owner
   */
  async getExchangeOwner(exchangeId: string): Promise<string> {
    let result = null
    try {
      result = await (await this.getExchange(exchangeId)).exchangeOwner
    } catch (e) {
      LoggerInstance.error(`ERROR: Failed to get OPF Collector address: ${e.message}`)
    }
    return result
  }

  /**
   * Estimate gas cost for updateMarketFee
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {String} newMarketFee New market fee
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estUpdateMarketFee(
    account: string,
    exchangeId: string,
    newMarketFee: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .updateMarketFee(exchangeId, newMarketFee)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Set new market fee, only market fee collector can update it
   * @param {String} address user address
   * @param {String} exchangeId ExchangeId
   * @param {String} newMarketFee New market fee
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async updateMarketFee(
    address: string,
    exchangeId: string,
    newMarketFee: string
  ): Promise<TransactionReceipt> {
    const estGas = await this.estSetRate(
      address,
      exchangeId,
      this.web3.utils.toWei(newMarketFee)
    )
    const trxReceipt = await this.contract.methods
      .updateMarketFee(exchangeId, this.web3.utils.toWei(newMarketFee))
      .send({
        from: address,
        gas: estGas + 1,
        gasPrice: await getFairGasPrice(this.web3)
      })
    return trxReceipt
  }

  /**
   * Estimate gas cost for updateMarketFeeCollector
   * @param {String} account
   * @param {String} exchangeId ExchangeId
   * @param {String} newMarketFee New market fee collector
   * @param {Contract} contractInstance optional contract instance
   * @return {Promise<number>}
   */
  public async estUpdateMarketFeeCollector(
    account: string,
    exchangeId: string,
    newMarketFeeCollector: string,
    contractInstance?: Contract
  ): Promise<number> {
    const fixedRate = contractInstance || this.fixedRateContract
    const gasLimitDefault = this.GASLIMIT_DEFAULT
    let estGas
    try {
      estGas = await fixedRate.methods
        .updateMarketFeeCollector(exchangeId, newMarketFeeCollector)
        .estimateGas({ from: account }, (err, estGas) => (err ? gasLimitDefault : estGas))
    } catch (e) {
      estGas = gasLimitDefault
    }
    return estGas
  }

  /**
   * Set new market fee collector, only market fee collector can update it
   * @param {String} address user address
   * @param {String} exchangeId ExchangeId
   * @param {String} newMarketFeeCollector New market fee collector
   * @return {Promise<TransactionReceipt>} transaction receipt
   */
  public async updateMarketFeeCollector(
    address: string,
    exchangeId: string,
    newMarketFeeCollector: string
  ): Promise<TransactionReceipt> {
    const estGas = await this.estUpdateMarketFeeCollector(
      address,
      exchangeId,
      newMarketFeeCollector
    )
    const trxReceipt = await this.contract.methods
      .updateMarketFeeCollector(exchangeId, newMarketFeeCollector)
      .send({
        from: address,
        gas: estGas + 1,
        gasPrice: await getFairGasPrice(this.web3)
      })
    return trxReceipt
  }
}
