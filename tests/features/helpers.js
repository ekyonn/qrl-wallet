// This file contains steps shared over multiple tests.

module.exports = function() {  
  'use strict';

  this.Given(/^I am on the site$/, function () {
    browser.url('http://localhost:3000')

    // Webdriver is not that good at scrolling with this here.
    // Had to remove it to hit the top menu in small window selenium
    // tests
    browser.execute(function() {
      document.getElementById("walletWarning").style.display = "none"
    })
  })

  this.When(/^I click Create Wallet$/, function () {
    browser.click('#createWalletHome')
  })

  this.When(/^type a passphrase "([^"]*)" in$/, function (arg1) {
    // For some reason, having a password type input element on the page breaks
    // the tests. This is a hack to change the type of the passphrase input
    // to text such that the walletCode setValue statement works.
    browser.execute(function() {
      // browser context
      passphraseBox = document.getElementById("basicPassphrase");
      passphraseBox.type = "text";
    })

    browser.setValue('#basicPassphrase', arg1)
  })
  
  this.When(/^press Create Basic Wallet$/, function () {
    client.moveToObject('#generateBasic')
    browser.click('#generateBasic')
  })

  this.Then(/^I should see Generating New Wallet$/, function () {
    let _el = '#generating'
    client.moveToObject(_el)
    browser.waitForVisible(_el, 30000)
  })

  this.Then(/^I should then see my wallet details$/, function () {
    let _el = 'h2.ui.header .sub.header'
    browser.waitForVisible(_el, 30000) // Max 30 seconds wallet generation time.
    expect(browser.getText(_el)).toEqual('Your new wallet details are below')
  })

  this.Then(/^I should see a loader icon$/, function () {
    let _el = '.loader'
    browser.waitForVisible(_el, 30000)
  })

  this.Then(/^I should see a loading icon$/, function () {
    let _el = '.loading'
    browser.waitForVisible(_el, 30000)
  })

};
