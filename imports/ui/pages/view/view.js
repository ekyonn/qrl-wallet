import './view.html'
/* global LocalStore */
/* global QRLLIB */

Template.appView.onRendered(() => {
  $('.ui.dropdown').dropdown()
})

const getAddressDetail = function (address) {
  Meteor.call('getAddress', address, (err, res) => {
    if (err) {
      console.log('error: ' + err)
      $('#unlocking').hide()
      $('#unlockError').show()
    } else {
      if (res.state.address !== '') {
        const successResult = {
          state: {
            balance: res.state.balance / 100000000, // FIXME - Magic number
            nonce: res.state.nonce,
          },
          transactions: res.state.transactions,
        }
        LocalStore.set('addressDetail', successResult)
      } else {
        // Wallet not found, put together an empty response
        const errorResult = {
          state: {
            balance: 0,
            nonce: 0,
          },
          transactions: [],
        }
        LocalStore.set('addressDetail', errorResult)
      }
      $('#topsection').hide()

      $('#addressDetail').show()
    }
  })
}

function viewWallet(walletType) {
  try {
    const userBinSeed = document.getElementById('walletCode').value
    let thisSeedBin

    // Generate binary seed
    if (walletType === 'hexseed') {
      thisSeedBin = QRLLIB.hstr2bin(userBinSeed)
    } else if (walletType === 'mnemonic') {
      thisSeedBin = QRLLIB.mnemonic2bin(userBinSeed)
    }

    const thisHexSeed = QRLLIB.bin2hstr(thisSeedBin)
    const thisMnemonic = QRLLIB.bin2mnemonic(thisSeedBin)

    let xmss = new QRLLIB.Xmss(thisSeedBin, 10)
    const thisAddress = xmss.getAddress()

    const walletDetail = {
      address: thisAddress,
      hexSeed: thisHexSeed,
      mnemonicPhrase: thisMnemonic,
    }

    LocalStore.set('walletDetail', walletDetail)

    getAddressDetail(walletDetail.address)
  } catch (error) {
    $('#unlockError').show()
    $('#unlocking').hide()
  }
}

Template.appView.events({
  'click #unlockButton': () => {
    $('#unlocking').show()
    const walletType = document.getElementById('walletType').value
    setTimeout(function () { viewWallet(walletType) }, 200)
  },
  'click #ShowTx': () => {
    $('table').show()
    $('#ShowTx').hide()
    $('#HideTx').show()
  },
  'click #HideTx': () => {
    $('table').hide()
    $('#ShowTx').show()
    $('#HideTx').hide()
  },
  'click .refresh': () => {
    getAddressDetail(LocalStore.get('walletDetail').address)
  },
})

Template.appView.helpers({
  addressDetail() {
    return LocalStore.get('addressDetail')
  },
  walletDetail() {
    return LocalStore.get('walletDetail')
  },
  addressQR() {
    return LocalStore.get('walletDetail').address
  },
  ts() {
    const x = moment.unix(this.timestamp)
    return moment(x).format('HH:mm D MMM YYYY')
  },
  txcount() {
    const addressDetail = LocalStore.get('addressDetail')
    try {
      const y = addressDetail.transactions.length
      return y
    } catch (e) {
      return 0
    }
  },
  nodeExplorerUrl() {
    return LocalStore.get('nodeExplorerUrl')
  },
})