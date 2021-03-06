// server-side startup
/* eslint no-console:0 */
/* global DEFAULT_NODES */
/* global SHOR_PER_QUANTA */

import { Meteor } from 'meteor/meteor'
import { check } from 'meteor/check'
import { BrowserPolicy } from 'meteor/browser-policy-common'
import grpc from 'grpc'
import tmp from 'tmp'
import fs from 'fs'
import async from 'async'

// Apply BrowserPolicy
BrowserPolicy.content.disallowInlineScripts()
BrowserPolicy.content.allowStyleOrigin('fonts.googleapis.com')
BrowserPolicy.content.allowFontOrigin('fonts.gstatic.com')
BrowserPolicy.content.allowFontDataUrl()

// An array of grpc connections and associated proto file paths
const qrlClient = []

function toBuffer(ab) {
  const buffer = Buffer.from(ab)
  return buffer
}

// Create a temp file to store the qrl.proto file in
// We'll also use the base directory of this file for other temp storage
// const qrlProtoFilePath = tmp.fileSync({ mode: 0644, prefix: 'qrl-', postfix: '.proto' }).name

const errorCallback = (error, message, alert) => {
  const d = new Date()
  const getTime = d.toUTCString()
  console.log(`${alert} [Timestamp: ${getTime}] ${error}`)
  const meteorError = new Meteor.Error(500, `[${getTime}] ${message} (${error})`)
  return meteorError
}

// Load the qrl.proto gRPC client into qrlClient from a remote node.
const loadGrpcClient = (request, callback) => {
  // Load qrlbase.proto and fetch current qrl.proto from node
  const baseGrpcObject = grpc.load(Assets.absoluteFilePath('qrlbase.proto'))
  const client = new baseGrpcObject.qrl.Base(request.grpc, grpc.credentials.createInsecure())

  client.getNodeInfo({}, (err, res) => {
    if (err) {
      console.log(`Error fetching qrl.proto from ${request.grpc}`)
      callback(err, null)
    } else {
      // Write a new temp file for this grpc connection
      const qrlProtoFilePath = tmp.fileSync({ mode: '0644', prefix: 'qrl-', postfix: '.proto' }).name

      fs.writeFile(qrlProtoFilePath, res.grpcProto, (fsErr) => {
        if (fsErr) throw fsErr

        const grpcObject = grpc.load(qrlProtoFilePath)

        // Create the gRPC Connection
        qrlClient[request.grpc] =
        new grpcObject.qrl.PublicAPI(request.grpc, grpc.credentials.createInsecure())

        console.log(`qrlClient loaded for ${request.grpc}`)

        callback(null, true)
      })
    }
  })
}

// Client side function to establish a connection with a remote node.
// If there is no active server side connection for the requested node,
// this function will call loadGrpcClient to establish one.

const connectToNode = (request, callback) => {
  // First check if there is an existing object to store the gRPC connection
  if (qrlClient.hasOwnProperty(request.grpc) === true) {
    console.log('Existing connection found for ', request.grpc, ' - attempting getNodeState')
    // There is already a gRPC object for this server stored.
    // Attempt to connect to it.
    try {
      qrlClient[request.grpc].getNodeState({}, (err, response) => {
        if (err) {
          console.log('Error fetching node state for ', request.grpc)
          // If it errors, we're going to remove the object and attempt to connect again.
          delete qrlClient[request.grpc]

          console.log('Attempting re-connection to ', request.grpc)

          loadGrpcClient(request, (loadErr, loadResponse) => {
            if (loadErr) {
              console.log(`Failed to re-connect to node ${request.grpc}`)
              const myError = errorCallback(err, 'Cannot connect to remote node', '**ERROR/connection** ')
              callback(myError, null)
            } else {
              console.log(`Connected to ${request.grpc}`)
              callback(null, loadResponse)
            }
          })
        } else {
          console.log(`Node state for ${request.grpc} ok`)
          callback(null, response)
        }
      })
    } catch (err) {
      console.log('node state error exception')
      const myError = errorCallback(err, 'Cannot access API/getNodeState', '**ERROR/getNodeState**')
      callback(myError, null)
    }
  } else {
    console.log(`Establishing new connection to ${request.grpc}`)
    // We've not connected to this node before, let's establish a connection to it.
    loadGrpcClient(request, (err, response) => {
      if (err) {
        console.log(`Failed to connect to node ${request.grpc}`)
        const myError = errorCallback(err, 'Cannot connect to remote node', '**ERROR/connection** ')
        callback(myError, null)
      } else {
        console.log(`Connected to ${request.grpc}`)
        callback(null, response)
      }
    })
  }
}


// Function to call getKnownPeers API.
const getKnownPeers = (request, callback) => {
  qrlClient[request.grpc].getKnownPeers({}, (err, response) => {
    if (err) {
      callback(err, null)
    } else {
      callback(null, response)
    }
  })
}

const getStats = (request, callback) => {
  try {
    qrlClient[request.grpc].getStats({}, (err, response) => {
      if (err) {
        const myError = errorCallback(err, 'Cannot access API/GetStats', '**ERROR/getStats** ')
        callback(myError, null)
      } else {
        callback(null, response)
      }
    })
  } catch (err) {
    const myError = errorCallback(err, 'Cannot access API/GetStats', '**ERROR/GetStats**')
    callback(myError, null)
  }
}

// Function to call getAddressState API
const getAddressState = (request, callback) => {
  qrlClient[request.grpc].getAddressState({ address: request.address }, (err, response) => {
    if (err) {
      console.log(`Error: ${err.message}`)
      callback(err, null)
    } else {
      response.state.txcount = response.state.transaction_hashes.length
      response.state.transactions = []
      response.state.transaction_hashes.forEach((value) => {
        response.state.transactions.push({ txhash: Buffer.from(value).toString('hex') })
      })

      callback(null, response)
    }
  })
}


// Function to call getObject API and extract a txn Hash..
const getTxnHash = (request, callback) => {
  const txnHash = Buffer.from(request.query, 'hex')

  qrlClient[request.grpc].getObject({ query: txnHash }, (err, response) => {
    if (err) {
      console.log(`Error: ${err.message}`)
      callback(err, null)
    } else {
      if (response.found === true && response.result === 'transaction') {
        response.transaction.tx.addr_from =
          Buffer.from(response.transaction.tx.addr_from).toString()
        response.transaction.tx.transaction_hash =
          Buffer.from(response.transaction.tx.transaction_hash).toString('hex')
        response.transaction.tx.addr_to = ''
        response.transaction.tx.amount = ''
        if (response.transaction.coinbase) {
          response.transaction.tx.addr_to =
            Buffer.from(response.transaction.tx.coinbase.addr_to).toString()
          response.transaction.tx.coinbase.addr_to =
            Buffer.from(response.transaction.tx.coinbase.addr_to).toString()
          // FIXME: We need a unified way to format Quanta
          response.transaction.tx.amount = response.transaction.tx.coinbase.amount / SHOR_PER_QUANTA
        }
        if (response.transaction.tx.transfer) {
          response.transaction.tx.addr_to =
            Buffer.from(response.transaction.tx.transfer.addr_to).toString()
          response.transaction.tx.transfer.addr_to =
            Buffer.from(response.transaction.tx.transfer.addr_to).toString()
          // FIXME: We need a unified way to format Quanta
          response.transaction.tx.amount = response.transaction.tx.transfer.amount / SHOR_PER_QUANTA
        }
        response.transaction.tx.public_key = Buffer.from(response.transaction.tx.public_key).toString('hex')
        response.transaction.tx.signature = Buffer.from(response.transaction.tx.signature).toString('hex')

        callback(null, response)
      } else {
        callback('Unable to locate transaction', null)
      }
    }
  })
}

// Function to call transferCoins API
const transferCoins = (request, callback) => {
  const tx = {
    address_from: request.fromAddress,
    address_to: request.toAddress,
    amount: request.amount,
    fee: request.fee,
    xmss_pk: request.xmssPk,
    xmss_ots_index: request.xmssOtsKey,
  }

  qrlClient[request.grpc].transferCoins(tx, (err, response) => {
    if (err) {
      console.log(`Error:  ${err.message}`)
      callback(err, null)
    } else {
      const transferResponse = {
        txnHash: Buffer.from(response.transaction_unsigned.transaction_hash).toString('hex'),
        response,
      }

      callback(null, transferResponse)
    }
  })
}


const confirmTransaction = (request, callback) => {
  const confirmTxn = { transaction_signed: request.transaction_unsigned }
  const relayedThrough = []

  // change ArrayBuffer
  confirmTxn.transaction_signed.addr_from = toBuffer(confirmTxn.transaction_signed.addr_from)
  confirmTxn.transaction_signed.public_key = toBuffer(confirmTxn.transaction_signed.public_key)
  confirmTxn.transaction_signed.transaction_hash =
    toBuffer(confirmTxn.transaction_signed.transaction_hash)
  confirmTxn.transaction_signed.signature = toBuffer(confirmTxn.transaction_signed.signature)
  confirmTxn.transaction_signed.transfer.addr_to =
    toBuffer(confirmTxn.transaction_signed.transfer.addr_to)


  // Relay transaction through user node, then all default nodes.
  let txnResponse

  async.waterfall([
    // Relay through user node.
    function (wfcb) {
      qrlClient[request.grpc].pushTransaction(confirmTxn, (err) => {
        if (err) {
          console.log(`Error:  ${err.message}`)
          txnResponse = { error: err.message, response: err.message }
          wfcb()
        } else {
          const hashResponse = {
            txnHash: Buffer.from(confirmTxn.transaction_signed.transaction_hash).toString('hex'),
            signature: Buffer.from(confirmTxn.transaction_signed.signature).toString('hex'),
          }
          txnResponse = { error: null, response: hashResponse }
          relayedThrough.push(request.grpc)
          console.log(`Transaction sent via user node ${request.grpc}`)
          wfcb()
        }
      })
    },
    // Now relay through all default nodes that we have a connection too
    function(wfcb) {
      async.eachSeries(DEFAULT_NODES, (node, cb) => {
        if ((qrlClient.hasOwnProperty(node.grpc) === true) && (node.grpc !== request.grpc)) {
          // Push the transaction - we don't care for its response
          qrlClient[node.grpc].pushTransaction(confirmTxn, (err) => {
            if (err) {
              console.log(`Error: Failed to send transaction through ${node.grpc}`)
              cb()
            } else {
              console.log(`Transaction sent via ${node.grpc}`)
              relayedThrough.push(node.grpc)
              cb()
            }
          })
        } else {
          cb()
        }
      }, (err) => {
        if (err) console.error(err.message)
        console.log('all txns sent')
        wfcb()
      })
    },
  ], () => {
    // All done, send txn response
    txnResponse.relayed = relayedThrough
    callback(null, txnResponse)
  })
}


// Function to call GetTokenTxn API
const createTokenTxn = (request, callback) => {
  const tx = {
    address_from: request.addressFrom,
    symbol: request.symbol,
    name: request.name,
    owner: request.owner,
    decimals: request.decimals,
    initial_balances: request.initialBalances,
    fee: request.fee,
    owner: request.owner,
    owner: request.owner,
    xmss_pk: request.xmssPk,
    xmss_ots_index: request.xmssOtsKey,
  }

  qrlClient[request.grpc].getTokenTxn(tx, (err, response) => {
    if (err) {
      console.log(`Error:  ${err.message}`)
      callback(err, null)
    } else {
      const transferResponse = {
        txnHash: Buffer.from(response.transaction_unsigned.transaction_hash).toString('hex'),
        response,
      }

      callback(null, transferResponse)
    }
  })
}


const confirmTokenCreation = (request, callback) => {
  const confirmTxn = { transaction_signed: request.transaction_unsigned }
  const relayedThrough = []

  // change ArrayBuffer
  confirmTxn.transaction_signed.addr_from = toBuffer(confirmTxn.transaction_signed.addr_from)
  confirmTxn.transaction_signed.public_key = toBuffer(confirmTxn.transaction_signed.public_key)
  confirmTxn.transaction_signed.transaction_hash =
    toBuffer(confirmTxn.transaction_signed.transaction_hash)
  confirmTxn.transaction_signed.signature = toBuffer(confirmTxn.transaction_signed.signature)

  confirmTxn.transaction_signed.token.symbol =
    toBuffer(confirmTxn.transaction_signed.token.symbol)
  confirmTxn.transaction_signed.token.name =
    toBuffer(confirmTxn.transaction_signed.token.name)
  confirmTxn.transaction_signed.token.owner =
    toBuffer(confirmTxn.transaction_signed.token.owner)

  const initialBalances = confirmTxn.transaction_signed.token.initial_balances
  initialBalancesFormatted = []
  initialBalances.forEach (function (item) {
    item.address = toBuffer(item.address)
    initialBalancesFormatted.push(item)
  })
  // Overwrite inital_balances with our updated one
  confirmTxn.transaction_signed.token.initial_balances = initialBalancesFormatted

  // Relay transaction through user node, then all default nodes.
  let txnResponse

  async.waterfall([
    // Relay through user node.
    function (wfcb) {
      qrlClient[request.grpc].pushTransaction(confirmTxn, (err) => {
        if (err) {
          console.log(`Error:  ${err.message}`)
          txnResponse = { error: err.message, response: err.message }
          wfcb()
        } else {
          const hashResponse = {
            txnHash: Buffer.from(confirmTxn.transaction_signed.transaction_hash).toString('hex'),
            signature: Buffer.from(confirmTxn.transaction_signed.signature).toString('hex'),
          }
          txnResponse = { error: null, response: hashResponse }
          relayedThrough.push(request.grpc)
          console.log(`Transaction sent via user node ${request.grpc}`)
          wfcb()
        }
      })
    },
    // Now relay through all default nodes that we have a connection too
    function(wfcb) {
      async.eachSeries(DEFAULT_NODES, (node, cb) => {
        if ((qrlClient.hasOwnProperty(node.grpc) === true) && (node.grpc !== request.grpc)) {
          // Push the transaction - we don't care for its response
          qrlClient[node.grpc].pushTransaction(confirmTxn, (err) => {
            if (err) {
              console.log(`Error: Failed to send transaction through ${node.grpc}`)
              cb()
            } else {
              console.log(`Transaction sent via ${node.grpc}`)
              relayedThrough.push(node.grpc)
              cb()
            }
          })
        } else {
          cb()
        }
      }, (err) => {
        if (err) console.error(err.message)
        console.log('all txns sent')
        wfcb()
      })
    },
  ], () => {
    // All done, send txn response
    txnResponse.relayed = relayedThrough
    callback(null, txnResponse)
  })
}

// Function to call GetTransferTokenTxn API
const createTokenTransferTxn = (request, callback) => {
  const tx = {
    address_from: request.addressFrom,
    address_to: request.addressTo,
    token_txhash: request.tokenHash,
    amount: request.amount,
    fee: request.fee,
    xmss_pk: request.xmssPk,
    xmss_ots_index: request.xmssOtsKey
  }

  qrlClient[request.grpc].getTransferTokenTxn(tx, (err, response) => {
    if (err) {
      console.log(`Error:  ${err.message}`)
      callback(err, null)
    } else {
      const transferResponse = {
        txnHash: Buffer.from(response.transaction_unsigned.transaction_hash).toString('hex'),
        response,
      }

      callback(null, transferResponse)
    }
  })
}




const confirmTokenTransfer = (request, callback) => {
  const confirmTxn = { transaction_signed: request.transaction_unsigned }
  const relayedThrough = []

  // change ArrayBuffer
  confirmTxn.transaction_signed.addr_from = toBuffer(confirmTxn.transaction_signed.addr_from)
  confirmTxn.transaction_signed.public_key = toBuffer(confirmTxn.transaction_signed.public_key)
  confirmTxn.transaction_signed.transaction_hash =
    toBuffer(confirmTxn.transaction_signed.transaction_hash)
  confirmTxn.transaction_signed.signature = toBuffer(confirmTxn.transaction_signed.signature)

  
  confirmTxn.transaction_signed.transfer_token.token_txhash = 
    toBuffer(confirmTxn.transaction_signed.transfer_token.token_txhash)
  confirmTxn.transaction_signed.transfer_token.addr_to = 
    toBuffer(confirmTxn.transaction_signed.transfer_token.addr_to)
  
  // Relay transaction through user node, then all default nodes.
  let txnResponse

  async.waterfall([
    // Relay through user node.
    function (wfcb) {
      qrlClient[request.grpc].pushTransaction(confirmTxn, (err) => {
        if (err) {
          console.log(`Error:  ${err.message}`)
          txnResponse = { error: err.message, response: err.message }
          wfcb()
        } else {
          const hashResponse = {
            txnHash: Buffer.from(confirmTxn.transaction_signed.transaction_hash).toString('hex'),
            signature: Buffer.from(confirmTxn.transaction_signed.signature).toString('hex'),
          }
          txnResponse = { error: null, response: hashResponse }
          relayedThrough.push(request.grpc)
          console.log(`Transaction sent via user node ${request.grpc}`)
          wfcb()
        }
      })
    },
    // Now relay through all default nodes that we have a connection too
    function(wfcb) {
      async.eachSeries(DEFAULT_NODES, (node, cb) => {
        if ((qrlClient.hasOwnProperty(node.grpc) === true) && (node.grpc !== request.grpc)) {
          // Push the transaction - we don't care for its response
          qrlClient[node.grpc].pushTransaction(confirmTxn, (err) => {
            if (err) {
              console.log(`Error: Failed to send transaction through ${node.grpc}`)
              cb()
            } else {
              console.log(`Transaction sent via ${node.grpc}`)
              relayedThrough.push(node.grpc)
              cb()
            }
          })
        } else {
          cb()
        }
      }, (err) => {
        if (err) console.error(err.message)
        console.log('all txns sent')
        wfcb()
      })
    },
  ], () => {
    // All done, send txn response
    txnResponse.relayed = relayedThrough
    callback(null, txnResponse)
  })
}


// Define Meteor Methods
Meteor.methods({
  connectToNode(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(connectToNode)(request)
    return response
  },
  status(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(getStats)(request)
    return response
  },
  getPeers(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(getKnownPeers)(request)
    return response
  },
  getAddress(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(getAddressState)(request)
    return response
  },
  getTxnHash(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(getTxnHash)(request)
    return response
  },
  transferCoins(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(transferCoins)(request)
    return response
  },
  addressTransactions(request) {
    check(request, Object)
    const targets = request.tx
    const result = []
    targets.forEach((arr) => {
      const thisRequest = {
        query: arr.txhash,
        grpc: request.grpc,
      }

      const thisTxnHashResponse = Meteor.wrapAsync(getTxnHash)(thisRequest)
      let thisTxn = {}

      if (thisTxnHashResponse.transaction.tx.type == "TRANSFER") {
        thisTxn = {
          type: thisTxnHashResponse.transaction.tx.type,
          txhash: arr.txhash,
          amount: thisTxnHashResponse.transaction.tx.amount,
          from: thisTxnHashResponse.transaction.tx.addr_from,
          to: thisTxnHashResponse.transaction.tx.addr_to,
          ots_key: thisTxnHashResponse.transaction.tx.ots_key,
          fee: thisTxnHashResponse.transaction.tx.transfer.fee / SHOR_PER_QUANTA,
          block: thisTxnHashResponse.transaction.header.block_number,
          timestamp: thisTxnHashResponse.transaction.header.timestamp.seconds,
        }
      } else if (thisTxnHashResponse.transaction.tx.type == "TOKEN") {
        thisTxn = {
          type: thisTxnHashResponse.transaction.tx.type,
          txhash: arr.txhash,
          from: thisTxnHashResponse.transaction.tx.addr_from,
          symbol: Buffer.from(thisTxnHashResponse.transaction.tx.token.symbol).toString(),
          name: Buffer.from(thisTxnHashResponse.transaction.tx.token.name).toString(),
          ots_key: thisTxnHashResponse.transaction.tx.ots_key,
          fee: thisTxnHashResponse.transaction.tx.token.fee / SHOR_PER_QUANTA,
          block: thisTxnHashResponse.transaction.header.block_number,
          timestamp: thisTxnHashResponse.transaction.header.timestamp.seconds,
        }
      } else if (thisTxnHashResponse.transaction.tx.type == "TRANSFERTOKEN") {
        // Request Token Symbol
        const symbolRequest = {
          query: Buffer.from(thisTxnHashResponse.transaction.tx.transfer_token.token_txhash).toString('hex'),
          grpc: request.grpc,
        }
        const thisSymbolResponse = Meteor.wrapAsync(getTxnHash)(symbolRequest)
        const thisSymbol = Buffer.from(thisSymbolResponse.transaction.tx.token.symbol).toString()

        thisTxn = {
          type: thisTxnHashResponse.transaction.tx.type,
          txhash: arr.txhash,
          symbol: thisSymbol,
          amount: thisTxnHashResponse.transaction.tx.transfer_token.amount / SHOR_PER_QUANTA,
          from: thisTxnHashResponse.transaction.tx.addr_from,
          to: Buffer.from(thisTxnHashResponse.transaction.tx.transfer_token.addr_to).toString(),
          ots_key: thisTxnHashResponse.transaction.tx.ots_key,
          fee: thisTxnHashResponse.transaction.tx.transfer_token.fee / SHOR_PER_QUANTA, 
          block: thisTxnHashResponse.transaction.header.block_number,
          timestamp: thisTxnHashResponse.transaction.header.timestamp.seconds,
        }
      }

      result.push(thisTxn)
    })

    return result
  },
  confirmTransaction(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(confirmTransaction)(request)
    return response
  },
  createTokenTxn(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(createTokenTxn)(request)
    return response
  },
  confirmTokenCreation(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(confirmTokenCreation)(request)
    return response
  },
  createTokenTransferTxn(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(createTokenTransferTxn)(request)
    return response
  },
  confirmTokenTransfer(request) {
    this.unblock()
    check(request, Object)
    const response = Meteor.wrapAsync(confirmTokenTransfer)(request)
    return response
  },

})

// Server Startup commands
if (Meteor.isServer) {
  Meteor.startup(() => {
    console.log('QRL Wallet Starting')

    // Establish gRPC connections with all enabled, non-localhost DEFAULT_NODES
    DEFAULT_NODES.forEach((node) => {
      if ((node.disabled === '') && (node.id !== 'localhost')) {
        console.log(`Attempting to create gRPC connection to node: ${node.name} (${node.grpc}) ...`)

        loadGrpcClient(node, (err) => {
          if (err) {
            console.log(`Error connecting to: ${node.name} (${node.grpc}) ...`)
          } else {
            console.log(`Connection created successfully for: ${node.name} (${node.grpc}) ...`)
          }
        })
      }
    })
  })
}
