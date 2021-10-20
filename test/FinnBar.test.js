const FinnBar = artifacts.require("FinnBar");
const FINN = artifacts.require("FINN");
const { expectRevert, time } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-helpers/src/setup');
const assert = require('assert');

contract('FinnBar', ([owner, alice, bob, carol, dev, minter]) => {
    let initSupply = 100000000;
    let transferAmount = 1000000;
    let depositAmount = 10000;
    let tenTaxFeePercent = 1000;
    let finn;
    let finnBar;

    beforeEach(async () => {
        finn = await FINN.new(initSupply, {from: owner});
        finnBar = await FinnBar.new(finn.address, {from: owner});

        await finn.updateTaxFee(tenTaxFeePercent, {from: owner});
        await finn.transfer(alice, transferAmount, {from: owner});
        await finn.transfer(bob, transferAmount, {from: owner});
    });
    it('common info', async () => {
        assert.strictEqual((await finnBar.finn()), finn.address, "invalid finn token");
    });

    it('token balance', async () => {
        let aliceReceivedAmount = await finn.balanceOf(alice);
        let bobReceivedAmount = await finn.balanceOf(bob);
        assert.strictEqual(aliceReceivedAmount.lte(new web3.utils.BN(transferAmount)), true, "invalid alice init amount");
        assert.strictEqual(bobReceivedAmount.lte(new web3.utils.BN(transferAmount)), true, "invalid bob init amount");

        let barStakedBalanceNoDeposit = await finn.balanceOf(finnBar.address);
        let barMintedBalanceNoDeposit = await finnBar.totalSupply();
        assert.strictEqual(barStakedBalanceNoDeposit.eq(new web3.utils.BN(0)), true, "invalid finnBar staked deposit");
        assert.strictEqual(barMintedBalanceNoDeposit.eq(new web3.utils.BN(0)), true, "invalid finnBar minted deposit");
    });

    it('deposit without approve', async () => {
        await expectRevert(finnBar.deposit(depositAmount, {from: alice}), 'ERC20: transfer amount exceeds allowance');
    });

    it('deposit zero', async () => {
        await expectRevert(finnBar.deposit(0, {from: alice}), 'Transfer amount must be greater than zero');
    });

    it('deposit success', async () => {
        await finn.approve(finnBar.address, depositAmount, {from: alice});
        let aliceDepositReceipt = await finnBar.deposit(depositAmount, {from: alice});
        let aliceDepositLogs = aliceDepositReceipt.logs.filter( v => v.event === "Deposit");

        assert.strictEqual((await finn.balanceOf(finnBar.address)).lte(new web3.utils.BN(depositAmount)), true, "invalid finnBar alice staked deposit");
        assert.strictEqual((await finnBar.totalSupply()).lte(new web3.utils.BN(depositAmount)), true, "invalid finnBar alice minted deposit");
        assert.strictEqual(aliceDepositLogs[0].args.user, alice, "invalid finnBar alice user deposit");
        assert.strictEqual(aliceDepositLogs[0].args.inputAmount.eq(new web3.utils.BN(depositAmount)), true, "invalid finnBar alice input amount");
        assert.strictEqual(aliceDepositLogs[0].args.lockedAmount.gte(new web3.utils.BN(depositAmount).sub(new web3.utils.BN(depositAmount).mul(await finn.taxFee()).div(new web3.utils.BN(10000)))), true, "invalid finnBar alice locked amount");
        assert.strictEqual(aliceDepositLogs[0].args.lockedAmount.eq(aliceDepositLogs[0].args.mintedAmount), true, "invalid finnBar, rate should be 1:1 while no deposit exists");
    });

    it('withdraw zero', async () => {
        await expectRevert (finnBar.withdraw(0, {from: alice}), 'division by zero');
    });

    it('deposit and withdraw', async () => {
        await finn.approve(finnBar.address, depositAmount, {from: alice});
        let aliceDepositReceipt = await finnBar.deposit(depositAmount, {from: alice});
        let aliceDepositLogs = aliceDepositReceipt.logs.filter( v => v.event === "Deposit");

        assert.strictEqual((await finn.balanceOf(finnBar.address)).lte(new web3.utils.BN(depositAmount)), true, "invalid finnBar alice staked deposit");
        assert.strictEqual((await finnBar.totalSupply()).lte(new web3.utils.BN(depositAmount)), true, "invalid finnBar alice minted deposit");
        assert.strictEqual(aliceDepositLogs[0].args.user, alice, "invalid finnBar alice user deposit");
        assert.strictEqual(aliceDepositLogs[0].args.inputAmount.eq(new web3.utils.BN(depositAmount)), true, "invalid finnBar alice input amount");
        assert.strictEqual(aliceDepositLogs[0].args.lockedAmount.eq(new web3.utils.BN(depositAmount).sub(new web3.utils.BN(depositAmount).mul(await finn.taxFee()).div(new web3.utils.BN(10000)))), true, "invalid finnBar alice locked amount");
        assert.strictEqual(aliceDepositLogs[0].args.lockedAmount.eq(aliceDepositLogs[0].args.mintedAmount), true, "invalid finnBar, rate should be 1:1 while no deposit exists");

        let aliceLockedAmount = aliceDepositLogs[0].args.lockedAmount
        let aliceMintedAmount = aliceDepositLogs[0].args.mintedAmount;

        await time.advanceBlock();
        await finnBar.approve(finnBar.address, aliceMintedAmount, {from: alice});
        let aliceWithdrawReceipt = await finnBar.withdraw(aliceMintedAmount, {from: alice});
        let aliceWithdrawLogs = aliceWithdrawReceipt.logs.filter( v => v.event === "Withdraw");
        assert.strictEqual((await finn.balanceOf(finnBar.address)).gte(new web3.utils.BN(0)), true, "invalid finnBar alice staked withdraw");
        assert.strictEqual((await finnBar.totalSupply()).eq(new web3.utils.BN(0)), true, "invalid finnBar alice minted withdraw");
        assert.strictEqual(aliceWithdrawLogs[0].args.user, alice, "invalid finnBar alice user withdraw");
    });

    it('deposit and transfer', async () => {
        let aliceDepositAmount = await finn.balanceOf(alice);
        await finn.approve(finnBar.address, aliceDepositAmount, {from: alice});
        let aliceDepositReceipt = await finnBar.deposit(aliceDepositAmount, {from: alice});
        let aliceDepositLogs = aliceDepositReceipt.logs.filter( v => v.event === "Deposit");
        let aliceInputAmount = aliceDepositLogs[0].args.inputAmount;
        let aliceLockedAmount = aliceDepositLogs[0].args.lockedAmount;
        let aliceMintedAmount = aliceDepositLogs[0].args.mintedAmount;
        assert.strictEqual(aliceInputAmount.eq(aliceDepositAmount), true, "invalid finnBar alice input amount");
        assert.strictEqual(aliceLockedAmount.gte(aliceDepositAmount.sub(new web3.utils.BN(aliceDepositAmount).mul(await finn.taxFee()).div(new web3.utils.BN(10000)))), true, "invalid finnBar alice locked amount");
        assert.strictEqual(aliceDepositLogs[0].args.lockedAmount.eq(aliceDepositLogs[0].args.mintedAmount), true, "invalid finnBar, rate should be 1:1 while no deposit exists");

        let barBeforeTransferAmount = await finn.balanceOf(finnBar.address);
        await finn.transfer(carol, transferAmount, {from: owner});
        let barAfterTransferAmount = await finn.balanceOf(finnBar.address);

        await finnBar.approve(finnBar.address, aliceMintedAmount, {from: alice});
        let aliceWithdrawReceipt = await finnBar.withdraw(aliceMintedAmount, {from: alice});
        let aliceWithdrawLogs = aliceWithdrawReceipt.logs.filter( v => v.event === "Withdraw");
        let aliceReleasedAmount = aliceWithdrawLogs[0].args.releasedAmount;
        let aliceBurnedAmount = aliceWithdrawLogs[0].args.burnedAmount;
        barStakedBalanceAliceDeposit = await finn.balanceOf(finnBar.address);

        assert.strictEqual((await finn.balanceOf(finnBar.address)).eq(new web3.utils.BN(0)), true, "invalid finnBar alice staked withdraw");
        assert.strictEqual((await finnBar.totalSupply()).eq(new web3.utils.BN(0)), true, "invalid finnBar alice minted withdraw");
        assert.strictEqual(aliceReleasedAmount.eq(barAfterTransferAmount), true, "released amount of alice is not equal to finnBar")
        assert.strictEqual(aliceReleasedAmount.gt(aliceLockedAmount), true, "invalid alice release or lock amount")
        assert.strictEqual(aliceBurnedAmount.eq(aliceMintedAmount), true, "invalid alice burn amount")
        assert.strictEqual(aliceWithdrawLogs[0].args.user, alice, "invalid finnBar alice user withdraw");
    });

    it('deposit mixing', async () => {
        let aliceDepositAmount = await finn.balanceOf(alice);
        await finn.approve(finnBar.address, aliceDepositAmount, {from: alice});
        let aliceDepositReceipt = await finnBar.deposit(aliceDepositAmount, {from: alice});
        let aliceDepositLogs = aliceDepositReceipt.logs.filter( v => v.event === "Deposit");
        assert.strictEqual(aliceDepositLogs[0].args.inputAmount.eq(aliceDepositAmount), true, "invalid finnBar alice input amount");
        assert.strictEqual(aliceDepositLogs[0].args.lockedAmount.gte(aliceDepositAmount.sub(new web3.utils.BN(aliceDepositAmount).mul(await finn.taxFee()).div(new web3.utils.BN(10000)))), true, "invalid finnBar alice locked amount");
        assert.strictEqual(aliceDepositLogs[0].args.lockedAmount.eq(aliceDepositLogs[0].args.mintedAmount), true, "invalid finnBar, rate should be 1:1 while no deposit exists");

        let aliceMintedAmount = aliceDepositLogs[0].args.mintedAmount;

        let barOldBeforeTransferAmount = await finn.balanceOf(finnBar.address);
        await finn.transfer(carol, transferAmount, {from: owner});
        let barOldAfterTransferAmount = await finn.balanceOf(finnBar.address);
        assert.strictEqual(barOldAfterTransferAmount.gte(barOldBeforeTransferAmount), true, "invalid finnBar balance of increasement");

        time.advanceBlock();
        await finn.approve(finnBar.address, depositAmount, {from: bob});
        let bobDepositReceipt = await finnBar.deposit(depositAmount, {from: bob});
        let bobDepositLogs = bobDepositReceipt.logs.filter( v => v.event === "Deposit");
        assert.strictEqual(bobDepositLogs[0].args.lockedAmount.lt(new web3.utils.BN(depositAmount)), true, "invalid finnBar bob staked deposit");
        assert.strictEqual(bobDepositLogs[0].args.mintedAmount.lt(bobDepositLogs[0].args.lockedAmount), true, "invalid finnBar bob minted deposit");
        assert.strictEqual(bobDepositLogs[0].args.user, bob, "invalid finnBar bob user deposit");
        assert.strictEqual(bobDepositLogs[0].args.inputAmount.eq(new web3.utils.BN(depositAmount)), true, "invalid finnBar alice input amount");
        assert.strictEqual(bobDepositLogs[0].args.lockedAmount.gte(bobDepositLogs[0].args.mintedAmount), true, "invalid finnBar rate to mint");
        assert.strictEqual(bobDepositLogs[0].args.lockedAmount.gte(new web3.utils.BN(depositAmount).sub(new web3.utils.BN(depositAmount).mul(await finn.taxFee()).div(new web3.utils.BN(10000)))), true, "invalid finnBar alice locked amount");

        let bobMintedAmount = bobDepositLogs[0].args.mintedAmount;

        let barBeforeTransferAmount = await finn.balanceOf(finnBar.address);
        await finn.transfer(owner, (await finn.balanceOf(carol)), {from: carol});
        let barAfterTransferAmount = await finn.balanceOf(finnBar.address);
        assert.strictEqual(barAfterTransferAmount.gte(barBeforeTransferAmount), true, "invalid finnBar balance of increasement after bob deposit");

        await finnBar.approve(finnBar.address, aliceMintedAmount, {from: alice});
        let aliceWithdrawReceipt = await finnBar.withdraw(aliceMintedAmount, {from: alice});
        let aliceWithdrawLogs = aliceWithdrawReceipt.logs.filter( v => v.event === "Withdraw");
        assert.strictEqual((await finn.balanceOf(finnBar.address)).gt(new web3.utils.BN(0)), true, "invalid finnBar alice staked withdraw");
        assert.strictEqual((await finnBar.totalSupply()).gt(new web3.utils.BN(0)), true, "invalid finnBar alice minted withdraw");
        assert.strictEqual(aliceWithdrawLogs[0].args.user, alice, "invalid finnBar alice user withdraw");
        assert.strictEqual(aliceWithdrawLogs[0].args.releasedAmount.gte(aliceWithdrawLogs[0].args.burnedAmount), true, "invalid finnBar alice final amount withdraw");

        await finnBar.approve(finnBar.address, bobMintedAmount, {from: bob});
        let bobWithdrawReceipt = await finnBar.withdraw(bobMintedAmount, {from: bob});
        let bobWithdrawLogs = bobWithdrawReceipt.logs.filter( v => v.event === "Withdraw");
        assert.strictEqual((await finnBar.totalSupply()).eq(new web3.utils.BN(0)), true, "invalid finnBar bob minted withdraw");
        assert.strictEqual(bobWithdrawLogs[0].args.user, bob, "invalid finnBar bob user withdraw");
        assert.strictEqual(bobWithdrawLogs[0].args.releasedAmount.gte(bobWithdrawLogs[0].args.burnedAmount), true, "invalid finnBar bob final amount withdraw");
    });
});
