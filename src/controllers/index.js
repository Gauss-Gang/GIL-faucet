const EthereumTx = require('ethereumjs-tx').Transaction
const { generateErrorResponse } = require('../helpers/generate-response')
const  { validateCaptcha } = require('../helpers/captcha-helper')
const { debug } = require('../helpers/debug')

const tokenAddresses = {
	"NOBLE": "0xFA4844cc662F4b509BDb752E249F9c729971FA29",
	"CTT": "0xb06E20B0F3aA014F3Bf50cb3FA1e5C15113A30F0",
	"DGT": "0x3974a70DB923C995c1F4E0841604856F28B1BeA7",
	"DKT": "0xFDB28f6C5d8daB66b7fda0D66c09aF24425017Af",
	"FTT": "0x760A8A3b52a28eE55db35cd69F616970863ec2d5",
	"SHT": "0xAa42C73a0ef2ab7115369C0cCa5664Cf77F4b365",
	"wGANG": "0x35A04074b062ECfA9DB4070A8f1d5aF35Dcf0699",
	"xNOBLE": "0x128BD023f6F99cB0fD3a061e7541076d4f634b14"
}

const contractABI = [
	// transfer
	{
	  "constant": false,
	  "inputs": [
		{
		  "name": "_to",
		  "type": "address"
		},
		{
		  "name": "_value",
		  "type": "uint256"
		}
	  ],
	  "name": "transfer",
	  "outputs": [
		{
		  "name": "",
		  "type": "bool"
		}
	  ],
	  "type": "function"
	},
	// Other functions like balanceOf, totalSupply, etc.
];

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

			const tx = {
				from: account.address,
				to: tokenAddresses[token],
				data: tokenContract.methods.transfer(receiver, ethToSend).encodeABI(),
				nonce: nonceHex,
				gasPrice: gasPriceHex,
				gasLimit: gasLimitHex,
			};
			
			const signedTx = await web3.eth.accounts.signTransaction(tx, senderPrivateKey);
			
			web3.eth.sendSignedTransaction(signedTx.rawTransaction)
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