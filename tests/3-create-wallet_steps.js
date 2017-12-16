module.exports = function () {  
  'use strict';

  this.When(/^I click Create Wallet$/, function () {
    browser.click('#createWalletHome')
  })

  this.When(/^press Begin$/, function () {
    browser.click('#generate')
  })

  this.Then(/^I should see Generating New Wallet$/, function () {
    let _el = '#generating p'
    browser.waitForVisible(_el)
    expect(browser.getText(_el)).toEqual('Generating new wallet...')
  })

  this.Then(/^I should then see my wallet details$/, function () {
    let _el = '#walletDetails h2 a'
    browser.waitForVisible(_el, 30000) // Max 30 seconds wallet generation time.
    expect(browser.getText(_el)).toEqual('Address')
  })
};