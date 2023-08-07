const EthereumTx = require('ethereumjs-tx').Transaction
const { generateErrorResponse } = require('../helpers/generate-response')
const  { validateCaptcha } = require('../helpers/captcha-helper')
const { debug } = require('../helpers/debug')

const tokenAddresses = {
	// "NOBLE": "0xFA4844cc662F4b509BDb752E249F9c729971FA29",
	"CTT": "0xb943A963b98DffBef4A7fEbFEAa271e2E3E58AE2",
	"DGT": "0xBB9408a0e1D65986D2Aa2bdE370E2bD6aa279fa1",
	"DKT": "0x4660df28e58625b08184A0AdB03A56bdd6274e77",
	"FTT": "0x0C9C5Ab0Bd51e703CFC5529A4F88174DD77CE073",
	"SHT": "0x8AA6A202E5591d44D7cC5de573565FaBAe18e5C7",
	// "wGANG": "0x35A04074b062ECfA9DB4070A8f1d5aF35Dcf0699",
	// "xNOBLE": "0x128BD023f6F99cB0fD3a061e7541076d4f634b14"
}

const contractABI = [{"type":"constructor","inputs":[]},{"type":"function","stateMutability":"view","outputs":[{"type":"uint256","name":"","internalType":"uint256"}],"name":"allowance","inputs":[{"type":"address","name":"owner","internalType":"address"},{"type":"address","name":"spender","internalType":"address"}]},{"type":"function","stateMutability":"nonpayable","outputs":[{"type":"bool","name":"","internalType":"bool"}],"name":"approve","inputs":[{"type":"address","name":"spender","internalType":"address"},{"type":"uint256","name":"amount","internalType":"uint256"}]},{"type":"function","stateMutability":"view","outputs":[{"type":"uint256","name":"","internalType":"uint256"}],"name":"balanceOf","inputs":[{"type":"address","name":"account","internalType":"address"}]},{"type":"function","stateMutability":"view","outputs":[{"type":"uint8","name":"","internalType":"uint8"}],"name":"decimals","inputs":[]},{"type":"function","stateMutability":"nonpayable","outputs":[{"type":"bool","name":"","internalType":"bool"}],"name":"decreaseAllowance","inputs":[{"type":"address","name":"spender","internalType":"address"},{"type":"uint256","name":"subtractedValue","internalType":"uint256"}]},{"type":"function","stateMutability":"nonpayable","outputs":[{"type":"bool","name":"","internalType":"bool"}],"name":"increaseAllowance","inputs":[{"type":"address","name":"spender","internalType":"address"},{"type":"uint256","name":"addedValue","internalType":"uint256"}]},{"type":"function","stateMutability":"view","outputs":[{"type":"string","name":"","internalType":"string"}],"name":"name","inputs":[]},{"type":"function","stateMutability":"view","outputs":[{"type":"string","name":"","internalType":"string"}],"name":"symbol","inputs":[]},{"type":"function","stateMutability":"view","outputs":[{"type":"uint256","name":"","internalType":"uint256"}],"name":"totalSupply","inputs":[]},{"type":"function","stateMutability":"nonpayable","outputs":[{"type":"bool","name":"","internalType":"bool"}],"name":"transfer","inputs":[{"type":"address","name":"to","internalType":"address"},{"type":"uint256","name":"amount","internalType":"uint256"}]},{"type":"function","stateMutability":"nonpayable","outputs":[{"type":"bool","name":"","internalType":"bool"}],"name":"transferFrom","inputs":[{"type":"address","name":"from","internalType":"address"},{"type":"address","name":"to","internalType":"address"},{"type":"uint256","name":"amount","internalType":"uint256"}]},{"type":"event","name":"Approval","inputs":[{"type":"address","name":"owner","indexed":true},{"type":"address","name":"spender","indexed":true},{"type":"uint256","name":"value","indexed":false}],"anonymous":false},{"type":"event","name":"Transfer","inputs":[{"type":"address","name":"from","indexed":true},{"type":"address","name":"to","indexed":true},{"type":"uint256","name":"value","indexed":false}],"anonymous":false}]

module.exports = function (app) {
	const config = app.config
	const web3 = app.web3

	const messages = {
		INVALID_CAPTCHA: 'Invalid captcha',
		INVALID_ADDRESS: 'Invalid address',
		TX_HAS_BEEN_MINED_WITH_FALSE_STATUS: 'Transaction has been mined, but status is false',
		TX_HAS_BEEN_MINED: 'Tx has been mined',
	}

	app.post('/', async function(request, response) {
		const isDebug = app.config.debug
		const token = request.body.token;
		debug(isDebug, "REQUEST:")
		debug(isDebug, request.body)
		const recaptureResponse = request.body["g-recaptcha-response"]
		if (!recaptureResponse) {
			const error = {
				message: messages.INVALID_CAPTCHA,
			}
			return generateErrorResponse(response, error)
		}

		let captchaResponse
		try {
			captchaResponse = await validateCaptcha(app, recaptureResponse)
		} catch(e) {
			return generateErrorResponse(response, e)
		}
		const receiver = request.body.receiver
		if (await validateCaptchaResponse(captchaResponse, receiver, response)) {
			await sendPOAToRecipient(web3, receiver, response, isDebug, token)
		}
	});

	app.get('/health', async function(request, response) {
		let balanceInWei
		let balanceInEth
		const address = config.Ethereum[config.environment].account
		try {
			balanceInWei = await web3.eth.getBalance(address)
			balanceInEth = await web3.utils.fromWei(balanceInWei, "ether")
		} catch (error) {
			return generateErrorResponse(response, error)
		}

		const resp = {
			address,
			balanceInWei: balanceInWei,
			balanceInEth: Math.round(balanceInEth)
		}
		response.send(resp)
	});

	async function validateCaptchaResponse(captchaResponse, receiver, response) {
		if (!captchaResponse || !captchaResponse.success) {
			generateErrorResponse(response, {message: messages.INVALID_CAPTCHA})
			return false
		}

		return true
	}

	async function sendPOAToRecipient(web3, receiver, response, isDebug, token) {
		let senderPrivateKey = config.Ethereum[config.environment].privateKey
		const privateKeyHex = Buffer.from(senderPrivateKey, 'hex')
		if (!web3.utils.isAddress(receiver)) {
			return generateErrorResponse(response, {message: messages.INVALID_ADDRESS})
		}
		
		const gasPrice = web3.utils.toWei('1', 'gwei')
		const gasPriceHex = web3.utils.toHex(gasPrice)
		const gasLimitHex = web3.utils.toHex(config.Ethereum.gasLimit)
		const nonce = await web3.eth.getTransactionCount(config.Ethereum[config.environment].account)
		const nonceHex = web3.utils.toHex(nonce)
		const BN = web3.utils.BN
		const ethToSend = web3.utils.toWei(new BN(config.Ethereum.milliEtherToTransfer), "milliether")
		const account = web3.eth.accounts.privateKeyToAccount('0x' + senderPrivateKey);
		web3.eth.accounts.wallet.add(account);
		web3.eth.defaultAccount = account.address;
		let txHash

		if (token === 'GANG') {
			const tx = {
				nonce: nonceHex,
				gasPrice: gasPriceHex,
				gas: gasLimitHex,
				to: receiver, 
				value: ethToSend,
				data: '0x00'
			}

			web3.eth.sendTransaction(tx)
			.on('transactionHash', (_txHash) => {
				txHash = _txHash
			})
			.on('receipt', (receipt) => {
				debug(isDebug, receipt)
				if (receipt.status == '0x1') {
					return sendRawTransactionResponse(txHash, response)
				} else {
					const error = {
						message: messages.TX_HAS_BEEN_MINED_WITH_FALSE_STATUS,
					}
					return generateErrorResponse(response, error);
				}
			})
			.on('error', (error) => {
				return generateErrorResponse(response, error)
			});
		} else {
			const tokenContract = new web3.eth.Contract(contractABI, tokenAddresses[token]);

			tokenContract.methods.transfer(receiver, ethToSend).send({
				from: account.address,
				gas: gasLimitHex,
				gasPrice: gasPriceHex,
				nonce: nonceHex
			})
			.on('transactionHash', function(hash){
				txHash = hash
			})
			.on('confirmation', function(confirmationNumber, receipt){
				debug(isDebug, receipt)
				if (receipt.status == true) { // you should use boolean true instead of '0x1'
					return sendRawTransactionResponse(txHash, response)
				} else {
					const error = {
						message: messages.TX_HAS_BEEN_MINED_WITH_FALSE_STATUS,
					}
					return generateErrorResponse(response, error);
				}
			})
			.on('error', console.error); // If an out of gas error, the second parameter is the receipt.
		}
	}

	function sendRawTransactionResponse(txHash, response) {
		const successResponse = {
			code: 200, 
			title: 'Success', 
			message: messages.TX_HAS_BEEN_MINED,
			txHash: txHash
		}
	  	
	  	response.send({
	  		success: successResponse
	  	})
	}
}