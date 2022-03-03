const assert = require('assert');
const { expectRevert, time, constants } = require('@openzeppelin/test-helpers');
const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const FINN = artifacts.require('FINN');
const FinnBar = artifacts.require('FinnBar');
const HuckleberryFarm = artifacts.require('HuckleberryFarm');
const TomVault = artifacts.require('TomVault');
const MockERC20 = artifacts.require('MockERC20');

contract('TomVault', ([owner, admin, operator, treasury, dev, alice, bob, carol]) => {
    const zero = new web3.utils.BN(0);
    const two = new web3.utils.BN(2);
    const three = new web3.utils.BN(3);
    const seven = new web3.utils.BN(7);
    const ten = new web3.utils.BN(10);
    const twelve = new web3.utils.BN(12);
    const eighteen = new web3.utils.BN(18);
    const hundred = ten.pow(two);
    const thousand = ten.pow(three);
    const tenPow12 = ten.pow(twelve);
    const tenPow18 = ten.pow(eighteen);
    const decimals18 = tenPow18;
    const thousandOneDecimals18 = ten.pow(three).mul(decimals18);
    const finnInitialSupply = ten.pow(seven).mul(decimals18); 

    beforeEach(async () => {
        this.finn = await FINN.new(finnInitialSupply, { from: owner });
        this.finnBar = await FinnBar.new(this.finn.address, { from: owner });
        this.startTime = (await time.latest()).add(time.duration.seconds(600));
        this.endTime = this.startTime.add(time.duration.seconds(600000));
        this.farm = await HuckleberryFarm.new(this.finn.address, dev, '1000', this.startTime, this.endTime, { from: owner });
        this.autoPid = await this.farm.poolLength();
        this.vault = await TomVault.new(this.autoPid, this.finnBar.address, this.farm.address, admin, operator, treasury, { from: owner });
        this.stuck = await MockERC20.new('Stuck Token', 'STUCK', 18, thousandOneDecimals18, { from: alice });

        await this.finn.updateTaxFee(zero, {from: owner});
        await this.finn.transfer(alice, thousandOneDecimals18, {from: owner}); // 1000 TOM
        await this.finn.transfer(bob, thousandOneDecimals18, {from: owner}); // 1000 TOM
        await this.finn.transfer(this.farm.address, finnInitialSupply.sub(thousandOneDecimals18).sub(thousandOneDecimals18), {from: owner}); // 10000000-alice(1000)-bob(1000) TOM
        await this.finn.approve(this.finnBar.address, thousandOneDecimals18, { from: alice });
        await this.finn.approve(this.finnBar.address, thousandOneDecimals18, { from: bob });

        this.MAX_PERFORMANCE_FEE = await this.vault.MAX_PERFORMANCE_FEE();
        this.MAX_CALL_FEE = await this.vault.MAX_CALL_FEE();
        this.DENOMINATOR = await this.vault.DENOMINATOR();

        this.calculateHarvestTomRewards = async () => {
            var harvestCallResult = await this.vault.harvest.call();
            return new web3.utils.BN(harvestCallResult.callerReward);
        }

        this.calculateTotalPendingTomRewards = async () => {
            var harvestCallResult = await this.vault.harvest.call();
            return new web3.utils.BN(harvestCallResult.totalPending);
        }

        this.calculateTotalPendingTomDetails = async () => {
            var harvestCallResult = await this.vault.harvest.call();
            return harvestCallResult;
        }

        this.actualRewardTime = async (depositTime, claimTime) => {
            var startTime = await this.farm.startTime();
            var endTime = await this.farm.allEndTime();
            if (depositTime.gt(endTime) || claimTime.lt(startTime)) {
                return zero;
            }
            if (depositTime.gte(claimTime)) {
                throw new Error("deposit is later than reward");
            }
            if (depositTime.lt(startTime)) {
                depositTime = startTime;
            }
            if (claimTime.gt(endTime)) {
                claimTime = endTime;
            }
            return claimTime.sub(depositTime);
        }

        this.calcFarmPendingReward = (finnPerSecond, secondDuration) => {
            return new web3.utils.BN(finnPerSecond).mul(new web3.utils.BN(secondDuration));
        }

        this.estimateShareToTom = async (_share) => {
            var vaultPricePerFullShare = await this.vault.getPricePerFullShare();
            var estimateTotalTomAmount = _share.mul(vaultPricePerFullShare).div(tenPow18);
            return estimateTotalTomAmount
        }

        this.estimateTomToShare = async (_amount) => {
            var vaultPricePerFullShare = await this.vault.getPricePerFullShare();
            var estimateShares = _amount.mul(tenPow18).div(vaultPricePerFullShare);
            return estimateShares;
        }

    });

    it('set treasury by non-admin', async () => {
        await expectRevert(this.vault.setTreasury(constants.ZERO_ADDRESS, {from: alice}), 'not admin');
    });

    it('set setTreasury with zero address', async () => {
        await expectRevert(this.vault.setTreasury(constants.ZERO_ADDRESS, {from: admin}), 'cannot be zero address');
    });

    it('set performanceFee by non-operator', async () => {
        await expectRevert(this.vault.setPerformanceFee(ten, {from: alice}), 'not operator');
    });

    it('set performanceFee overflow', async () => {
        await expectRevert(this.vault.setPerformanceFee(this.MAX_PERFORMANCE_FEE.add(ten), {from: operator}), 'performanceFee cannot be more than MAX_PERFORMANCE_FEE');
    });

    it('set setCallFee overflow', async () => {
        await expectRevert(this.vault.setCallFee(this.MAX_CALL_FEE.add(ten), {from: operator}), 'callFee cannot be more than MAX_CALL_FEE');
    });

    it('inCaseTokensGetStuck success', async () => {
        await this.stuck.transfer(this.vault.address, thousandOneDecimals18, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.stuck.balanceOf(this.vault.address)).eq(thousandOneDecimals18), true, "invalid vault stuck amount");
        await this.vault.inCaseTokensGetStuck(this.stuck.address, {from: admin});
        assert.strictEqual(new web3.utils.BN(await this.stuck.balanceOf(admin)).eq(thousandOneDecimals18), true, "invalid admin stuck amount");
    });

    it('inCaseTokensGetStuck by non-admin', async () => {
        await expectRevert(this.vault.inCaseTokensGetStuck(this.stuck.address, {from: alice}), 'not admin');
    });

    it('inCaseTokensGetStuck should be failed while token is TOM or FINN', async () => {
        await expectRevert(this.vault.inCaseTokensGetStuck(this.finnBar.address, {from: admin}), 'token cannot be same as deposit token');
        await expectRevert(this.vault.inCaseTokensGetStuck(await this.finnBar.finn(), {from: admin}), 'token cannot be same as internal token of deposit token');
    });

    it('pause by non-operator', async () => {
        await expectRevert(this.vault.pause({from: admin}), 'not operator');
    });

    it('double pause should be failed', async () => {
        await this.vault.pause({from: operator});
        await expectRevert(this.vault.pause({from: operator}), 'Pausable: paused');
    });

    it('unpause by non-operator', async () => {
        await expectRevert(this.vault.unpause({from: admin}), 'not operator');
    });

    it('unpause should be failed while not paused', async () => {
        await expectRevert(this.vault.unpause({from: operator}), 'Pausable: not paused');
    });

    it('pause and unpause success', async () => {
        await this.vault.pause({from: operator});
        await this.vault.unpause({from: operator});
    });

    it('update operator', async () => {
        var OPERATOR_ROLE = await this.vault.OPERATOR_ROLE();
        await this.vault.revokeRole(OPERATOR_ROLE, operator, {from: admin});
        assert.strictEqual((await this.vault.hasRole(OPERATOR_ROLE, operator)), false, "revoke operator failed");

        await this.vault.grantRole(OPERATOR_ROLE, admin, {from: admin});
        assert.strictEqual((await this.vault.hasRole(OPERATOR_ROLE, admin)), true, "grant admin to operator failed");

        await this.vault.revokeRole(OPERATOR_ROLE, admin, {from: admin});
        assert.strictEqual((await this.vault.hasRole(OPERATOR_ROLE, admin)), false, "revoke admin to operator failed");

        await this.vault.grantRole(OPERATOR_ROLE, operator, {from: admin});
        assert.strictEqual((await this.vault.hasRole(OPERATOR_ROLE, operator)), true, "reset operator failed");
    });

    it('deposit 0 should be failed', async () => {
        await this.farm.add('100', this.finnBar.address, false);

        var aliceFinnBalance = new web3.utils.BN(await this.finn.balanceOf(alice));
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        await expectRevert(this.vault.deposit(zero, {from: alice}), 'nothing to deposit');
    });

    it('depositAll should be failed while token balance is 0', async () => {
        await this.farm.add('100', this.finnBar.address, false);

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });
        await expectRevert(this.vault.depositAll({from: alice}), 'nothing to deposit');
    });

    it('deposit should be failed while paused', async () => {
        await this.vault.pause({from: operator});

        await this.farm.add('100', this.finnBar.address, false);

        var aliceFinnBalance = new web3.utils.BN(await this.finn.balanceOf(alice));
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        await expectRevert(this.vault.deposit(await this.finnBar.balanceOf(alice), {from: alice}), 'Pausable: paused');
    });

    it('depositAll should be failed while paused', async () => {
        await this.vault.pause({from: operator});

        await this.farm.add('100', this.finnBar.address, false);

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });
        await expectRevert(this.vault.depositAll({from: alice}), 'Pausable: paused');
    });

    it('harvest should be failed while paused', async () => {
        await this.vault.pause({from: operator});

        await expectRevert(this.vault.harvest({from: alice}), 'Pausable: paused');
    });

    it('depositAll success while disable finn fee', async () => {
        // var pid = await this.farm.poolLength();
        await this.farm.add('100', this.finnBar.address, false);

        var aliceFinnBalance = new web3.utils.BN(await this.finn.balanceOf(alice));
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var receipt = await this.vault.depositAll({ from: alice });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid amount and shares");
        assert.strictEqual(new web3.utils.BN(await this.vault.balanceOf(alice)).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice vault amount");

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(new web3.utils.BN(depositLog.args.amount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");
    });

    it('deposit success while disable finn fee', async () => {
        // var pid = await this.farm.poolLength();
        await this.farm.add('100', this.finnBar.address, false);

        var aliceFinnBalance = new web3.utils.BN(await this.finn.balanceOf(alice));
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var receipt = await this.vault.deposit((await this.finnBar.balanceOf(alice)), { from: alice });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid amount and shares");
        assert.strictEqual(new web3.utils.BN(await this.vault.balanceOf(alice)).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice vault amount");

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(new web3.utils.BN(depositLog.args.amount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");
    });

    it('withdraw TOM too small should be failed wile the shares is 0', async () => {
        await this.farm.add('100', this.finnBar.address, false);

        var aliceFinnBalance = new web3.utils.BN(await this.finn.balanceOf(alice));
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var receipt = await this.vault.depositAll({ from: alice });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid amount and shares");
        assert.strictEqual(new web3.utils.BN(await this.vault.balanceOf(alice)).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice vault amount");

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(new web3.utils.BN(depositLog.args.amount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        var withdrawTime = new web3.utils.BN(await this.farm.startTime()).add(time.duration.seconds(60000));
        if ((await time.latest()).lt(withdrawTime)) {
            await time.increaseTo(withdrawTime);
        }

        await expectRevert(this.vault.withdraw(zero, {from: alice}), 'too small shares');
    });

    it('deposit and check pending reward success', async () => {
        await this.farm.add('100', this.finnBar.address, true);
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));
        var receipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice vault amount");

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(new web3.utils.BN(depositLog.args.amount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        // update accRewardPerShare
        await this.farm.updatePool(this.autoPid);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var rewardDuration = await this.actualRewardTime(depositTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address));
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(estimateTotalReward.eq(farmPendingTom), true, "invalid pool vault pending reward");
        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");
    });

    it('deposit and harvest success', async () => {
        await this.farm.add('100', this.finnBar.address, true);
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // deposit
        var receipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice vault amount");

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(new web3.utils.BN(depositLog.args.amount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        // update accRewardPerShare
        await this.farm.updatePool(this.autoPid);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var rewardDuration = await this.actualRewardTime(depositTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address));
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(estimateTotalReward.eq(farmPendingTom), true, "invalid pool vault pending reward");
        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

        // harvest
        var receipt = await this.vault.harvest({from: carol});
        var filterLogs = receipt.logs.filter(v => v.event === "Harvest");
        var harvestLog = filterLogs[0];
        assert.strictEqual(harvestLog.args.sender.toLowerCase(), carol.toLowerCase(), "invalid harvest sender");
        assert.strictEqual(harvestLog.args.callFee.eq(await this.finnBar.balanceOf(carol)), true, "invalid callFee");
        assert.strictEqual(harvestLog.args.performanceFee.eq(await this.finnBar.balanceOf(treasury)), true, "invalid performanceFee");
    });

    it('deposit and withdraw success', async () => {
        await this.farm.add('100', this.finnBar.address, true);
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));
        var receipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var aliceShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice vault amount");

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(new web3.utils.BN(depositLog.args.amount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        // update accRewardPerShare
        await this.farm.updatePool(this.autoPid);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var rewardDuration = await this.actualRewardTime(depositTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address));
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(estimateTotalReward.eq(farmPendingTom), true, "invalid pool vault pending reward");
        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

        // reset totalBalance() for getPricePerFullShare
        await this.vault.harvest({from: carol});

        // withdraw
        var aliceVaultBeforeWithdraw = await this.vault.balanceOf(alice);
        var aliceTomBeforeWithdraw = await this.finnBar.balanceOf(alice);

        var aliceWithdrawAmount = aliceDepositAmount;
        var estimateWithdrawShares = await this.estimateTomToShare(aliceWithdrawAmount);
        if (estimateWithdrawShares.eq(zero)) {
            aliceWithdrawAmount = await this.estimateShareToTom(aliceShares.div(two));
            estimateWithdrawShares = await this.estimateTomToShare(aliceWithdrawAmount);
        }

        var receipt = await this.vault.withdraw(aliceWithdrawAmount, {from: alice});
        var filterLogs = receipt.logs.filter(v => v.event === "Withdraw");
        var withdrawLog = filterLogs[0];

        var aliceVaultAfterWithdraw = await this.vault.balanceOf(alice);
        var aliceTomAfterWithdraw = await this.finnBar.balanceOf(alice);

        assert.strictEqual(withdrawLog.args.sender.toLowerCase(), alice.toLowerCase(), "invalid withdraw sender");
        assert.strictEqual(withdrawLog.args.shares.lte(estimateWithdrawShares), true, "invalid withdraw shares");
        assert.strictEqual(withdrawLog.args.shares.eq(aliceVaultBeforeWithdraw.sub(aliceVaultAfterWithdraw)), true, "invalid user shares");
        assert.strictEqual(withdrawLog.args.amount.eq(aliceWithdrawAmount), true, "invalid withdraw amount");
        assert.strictEqual(withdrawLog.args.amount.eq(aliceTomAfterWithdraw.sub(aliceTomBeforeWithdraw)), true, "invalid user amount");
    });

    it('deposit and withdrawShares success', async () => {
        await this.farm.add('100', this.finnBar.address, true);
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));
        var receipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice vault amount");

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(new web3.utils.BN(depositLog.args.amount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        // update accRewardPerShare
        await this.farm.updatePool(this.autoPid);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var rewardDuration = await this.actualRewardTime(depositTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address));
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(estimateTotalReward.eq(farmPendingTom), true, "invalid pool vault pending reward");
        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

        // withdrawShares
        var aliceVaultBeforeWithdraw = await this.vault.balanceOf(alice);
        var aliceTomBeforeWithdraw = await this.finnBar.balanceOf(alice);

        var withdrawShares = await this.vault.balanceOf(alice);
        var estimateWithdrawTomAmount = await this.estimateShareToTom(withdrawShares);
        var estimateTomBack = estimateWithdrawTomAmount;

        var receipt = await this.vault.withdrawShares(withdrawShares, {from: alice});
        var filterLogs = receipt.logs.filter(v => v.event === "Withdraw");
        var withdrawLog = filterLogs[0];

        var aliceVaultAfterWithdraw = await this.vault.balanceOf(alice);
        var aliceTomAfterWithdraw = await this.finnBar.balanceOf(alice);

        assert.strictEqual(withdrawLog.args.sender.toLowerCase(), alice.toLowerCase(), "invalid withdraw sender");
        assert.strictEqual(withdrawLog.args.shares.eq(withdrawShares), true, "invalid withdraw shares");
        assert.strictEqual(withdrawLog.args.shares.eq(aliceVaultBeforeWithdraw.sub(aliceVaultAfterWithdraw)), true, "invalid user shares");
        assert.strictEqual(withdrawLog.args.amount.gte(estimateTomBack), true, "invalid withdraw amount");
        assert.strictEqual(withdrawLog.args.amount.eq(aliceTomAfterWithdraw.sub(aliceTomBeforeWithdraw)), true, "invalid user amount");
    });

    it('deposit, harvest and withdraw success', async () => {
        await this.farm.add('100', this.finnBar.address, true);
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);

        // deposit
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));
        var receipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var aliceShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(aliceShares), true, "invalid alice vault amount");

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(new web3.utils.BN(depositLog.args.amount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        // update accRewardPerShare
        await this.farm.updatePool(this.autoPid);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var rewardDuration = await this.actualRewardTime(depositTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address));
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(estimateTotalReward.eq(farmPendingTom), true, "invalid pool vault pending reward");
        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

        // harvest
        var receipt = await this.vault.harvest({from: carol});
        var filterLogs = receipt.logs.filter(v => v.event === "Harvest");
        var harvestLog = filterLogs[0];
        assert.strictEqual(harvestLog.args.sender.toLowerCase(), carol.toLowerCase(), "invalid harvest sender");
        assert.strictEqual(harvestLog.args.callFee.eq(await this.finnBar.balanceOf(carol)), true, "invalid callFee");
        assert.strictEqual(harvestLog.args.performanceFee.eq(await this.finnBar.balanceOf(treasury)), true, "invalid performanceFee");

        // withdraw
        var aliceVaultBeforeWithdraw = await this.vault.balanceOf(alice);
        var aliceTomBeforeWithdraw = await this.finnBar.balanceOf(alice);

        var aliceWithdrawAmount = aliceDepositAmount;
        var estimateWithdrawShares = await this.estimateTomToShare(aliceWithdrawAmount);
        if (estimateWithdrawShares.eq(zero)) {
            aliceWithdrawAmount = await this.estimateShareToTom(aliceShares.div(two));
            estimateWithdrawShares = await this.estimateTomToShare(aliceWithdrawAmount);
        }

        var receipt = await this.vault.withdraw(aliceWithdrawAmount, {from: alice});
        var filterLogs = receipt.logs.filter(v => v.event === "Withdraw");
        var withdrawLog = filterLogs[0];

        var aliceVaultAfterWithdraw = await this.vault.balanceOf(alice);
        var aliceTomAfterWithdraw = await this.finnBar.balanceOf(alice);

        assert.strictEqual(withdrawLog.args.sender.toLowerCase(), alice.toLowerCase(), "invalid withdraw sender");
        assert.strictEqual(withdrawLog.args.shares.lte(estimateWithdrawShares), true, "invalid withdraw shares");
        assert.strictEqual(withdrawLog.args.shares.eq(aliceVaultBeforeWithdraw.sub(aliceVaultAfterWithdraw)), true, "invalid user shares");
        assert.strictEqual(withdrawLog.args.amount.eq(aliceWithdrawAmount), true, "invalid withdraw amount");
        assert.strictEqual(withdrawLog.args.amount.eq(aliceTomAfterWithdraw.sub(aliceTomBeforeWithdraw)), true, "invalid user amount");
    });

    it('deposit, harvest and withdrawShares success', async () => {
        await this.farm.add('100', this.finnBar.address, true);
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);

        // deposit
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));
        var receipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var aliceShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(aliceShares), true, "invalid alice vault amount");

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(new web3.utils.BN(depositLog.args.amount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        // update accRewardPerShare
        await this.farm.updatePool(this.autoPid);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var rewardDuration = await this.actualRewardTime(depositTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address));
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(estimateTotalReward.eq(farmPendingTom), true, "invalid pool vault pending reward");
        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

        // harvest
        var receipt = await this.vault.harvest({from: carol});
        var filterLogs = receipt.logs.filter(v => v.event === "Harvest");
        var harvestLog = filterLogs[0];
        assert.strictEqual(harvestLog.args.sender.toLowerCase(), carol.toLowerCase(), "invalid harvest sender");
        assert.strictEqual(harvestLog.args.callFee.eq(await this.finnBar.balanceOf(carol)), true, "invalid callFee");
        assert.strictEqual(harvestLog.args.performanceFee.eq(await this.finnBar.balanceOf(treasury)), true, "invalid performanceFee");

        // withdrawShares
        var aliceVaultBeforeWithdraw = await this.vault.balanceOf(alice);
        var aliceTomBeforeWithdraw = await this.finnBar.balanceOf(alice);

        var withdrawShares = await this.vault.balanceOf(alice);
        var estimateWithdrawTomAmount = await this.estimateShareToTom(withdrawShares);
        var estimateTomBack = estimateWithdrawTomAmount;

        var receipt = await this.vault.withdrawShares(withdrawShares, {from: alice});
        var filterLogs = receipt.logs.filter(v => v.event === "Withdraw");
        var withdrawLog = filterLogs[0];

        var aliceVaultAfterWithdraw = await this.vault.balanceOf(alice);
        var aliceTomAfterWithdraw = await this.finnBar.balanceOf(alice);

        assert.strictEqual(withdrawLog.args.sender.toLowerCase(), alice.toLowerCase(), "invalid withdraw sender");
        assert.strictEqual(withdrawLog.args.shares.eq(withdrawShares), true, "invalid withdraw shares");
        assert.strictEqual(withdrawLog.args.shares.eq(aliceShares), true, "invalid withdraw shares about deposit");
        assert.strictEqual(withdrawLog.args.shares.eq(aliceVaultBeforeWithdraw.sub(aliceVaultAfterWithdraw)), true, "invalid user shares");
        assert.strictEqual(withdrawLog.args.amount.gte(estimateTomBack), true, "invalid withdraw amount");
        assert.strictEqual(withdrawLog.args.amount.eq(aliceTomAfterWithdraw.sub(aliceTomBeforeWithdraw)), true, "invalid user amount");
    });

    it('multi-deposit success', async () => {
        await this.farm.add('100', this.finnBar.address, true);

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var bobFinnBalance = hundred;
        await this.finnBar.deposit(bobFinnBalance, {from: bob});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(bob)).eq(bobFinnBalance), true, "invalid bob amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: bob });

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);
        var bobDepositAmount = (await this.finnBar.balanceOf(bob)).div(two);

        // alice deposit
        var receipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var aliceShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid alice deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(aliceShares), true, "invalid alice vault amount");

        assert.strictEqual(new web3.utils.BN(await this.farm.startTime()).gt(await time.latest()), true, "the pool should be not started");

        // bob deposit
        var receipt = await this.vault.deposit(bobDepositAmount, { from: bob });
        var filterLogs = receipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var bobShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid bob deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid bob amount and shares");
        assert.strictEqual(bobDepositAmount.eq(bobShares), true, "invalid bob vault amount");
    });

    it('multi-deposit and check pending reward success', async () => {
        await this.farm.add('100', this.finnBar.address, true);
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var bobFinnBalance = hundred;
        await this.finnBar.deposit(bobFinnBalance, {from: bob});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(bob)).eq(bobFinnBalance), true, "invalid bob amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: bob });

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);
        var bobDepositAmount = (await this.finnBar.balanceOf(bob)).div(two);

        // alice deposit
        var aliceReceipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = aliceReceipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var aliceShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid alice deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(aliceShares), true, "invalid alice vault amount");

        // bob deposit
        var bobReceipt = await this.vault.deposit(bobDepositAmount, { from: bob });
        var filterLogs = bobReceipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var bobShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid bob deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid bob amount and shares");
        assert.strictEqual(bobDepositAmount.eq(bobShares), true, "invalid bob vault amount");

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(aliceDepositAmount.add(bobDepositAmount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        // update accRewardPerShare
        await this.farm.updatePool(this.autoPid);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var rewardDuration = await this.actualRewardTime(startTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address));
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(estimateTotalReward.eq(farmPendingTom), true, "invalid pool vault pending reward");
        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

    });

    it('multi-deposit and harvest success', async () => {
        await this.farm.add('100', this.finnBar.address, true);
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var bobFinnBalance = hundred;
        await this.finnBar.deposit(bobFinnBalance, {from: bob});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(bob)).eq(bobFinnBalance), true, "invalid bob amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: bob });

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);
        var bobDepositAmount = (await this.finnBar.balanceOf(bob)).div(two);

        // alice deposit
        var aliceReceipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = aliceReceipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var aliceShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid alice deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(aliceShares), true, "invalid alice vault amount");

        // bob deposit
        var bobReceipt = await this.vault.deposit(bobDepositAmount, { from: bob });
        var filterLogs = bobReceipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var bobShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid bob deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid bob amount and shares");
        assert.strictEqual(bobDepositAmount.eq(bobShares), true, "invalid bob vault amount");

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(aliceDepositAmount.add(bobDepositAmount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        // update accRewardPerShare
        await this.farm.updatePool(this.autoPid);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var rewardDuration = await this.actualRewardTime(startTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address));
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(estimateTotalReward.eq(farmPendingTom), true, "invalid pool vault pending reward");
        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

        // harvest
        var receipt = await this.vault.harvest({from: carol});
        var filterLogs = receipt.logs.filter(v => v.event === "Harvest");
        var harvestLog = filterLogs[0];
        var harvestBlock = await web3.eth.getBlock(harvestLog.blockNumber);
        var harvestTime = new web3.utils.BN(harvestBlock.timestamp);
        assert.strictEqual(harvestLog.args.sender.toLowerCase(), carol.toLowerCase(), "invalid harvest sender");
        assert.strictEqual(harvestLog.args.callFee.eq(await this.finnBar.balanceOf(carol)), true, "invalid callFee");
        assert.strictEqual(harvestLog.args.performanceFee.eq(await this.finnBar.balanceOf(treasury)), true, "invalid performanceFee");

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address)).add(await this.finn.balanceOf(this.vault.address));
        var rewardDuration = await this.actualRewardTime(harvestTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");
    });

    it('multi-deposit and harvest and withdraw|withdrawAll success', async () => {
        await this.farm.add('100', this.finnBar.address, true);
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var bobFinnBalance = hundred;
        await this.finnBar.deposit(bobFinnBalance, {from: bob});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(bob)).eq(bobFinnBalance), true, "invalid bob amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: bob });

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);
        var bobDepositAmount = (await this.finnBar.balanceOf(bob)).div(two);

        // alice deposit
        var aliceReceipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = aliceReceipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var aliceShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid alice deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(aliceShares), true, "invalid alice vault amount");

        // bob deposit
        var bobReceipt = await this.vault.deposit(bobDepositAmount, { from: bob });
        var filterLogs = bobReceipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var bobShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid bob deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid bob amount and shares");
        assert.strictEqual(bobDepositAmount.eq(bobShares), true, "invalid bob vault amount");

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(aliceDepositAmount.add(bobDepositAmount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        // update accRewardPerShare
        await this.farm.updatePool(this.autoPid);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var rewardDuration = await this.actualRewardTime(startTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address));
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(estimateTotalReward.eq(farmPendingTom), true, "invalid pool vault pending reward");
        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

        // harvest
        var receipt = await this.vault.harvest({from: carol});
        var filterLogs = receipt.logs.filter(v => v.event === "Harvest");
        var harvestLog = filterLogs[0];
        var harvestBlock = await web3.eth.getBlock(harvestLog.blockNumber);
        var harvestTime = new web3.utils.BN(harvestBlock.timestamp);
        assert.strictEqual(harvestLog.args.sender.toLowerCase(), carol.toLowerCase(), "invalid harvest sender");
        assert.strictEqual(harvestLog.args.callFee.eq(await this.finnBar.balanceOf(carol)), true, "invalid callFee");
        assert.strictEqual(harvestLog.args.performanceFee.eq(await this.finnBar.balanceOf(treasury)), true, "invalid performanceFee");

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address)).add(await this.finn.balanceOf(this.vault.address));
        var rewardDuration = await this.actualRewardTime(harvestTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

        // withdraw alice
        var aliceVaultBeforeWithdraw = await this.vault.balanceOf(alice);
        var aliceTomBeforeWithdraw = await this.finnBar.balanceOf(alice);

        var aliceWithdrawAmount = aliceDepositAmount;
        var estimateWithdrawShares = await this.estimateTomToShare(aliceWithdrawAmount);
        if (estimateWithdrawShares.eq(zero)) {
            aliceWithdrawAmount = await this.estimateShareToTom(aliceShares.div(two));
            estimateWithdrawShares = await this.estimateTomToShare(aliceWithdrawAmount);
        }

        var receipt = await this.vault.withdraw(aliceWithdrawAmount, {from: alice});
        var filterLogs = receipt.logs.filter(v => v.event === "Withdraw");
        var withdrawLog = filterLogs[0];

        var aliceVaultAfterWithdraw = await this.vault.balanceOf(alice);
        var aliceTomAfterWithdraw = await this.finnBar.balanceOf(alice);

        assert.strictEqual(withdrawLog.args.sender.toLowerCase(), alice.toLowerCase(), "invalid withdraw sender");
        assert.strictEqual(withdrawLog.args.shares.lt(estimateWithdrawShares), true, "invalid withdraw shares");
        assert.strictEqual(withdrawLog.args.shares.eq(aliceVaultBeforeWithdraw.sub(aliceVaultAfterWithdraw)), true, "invalid user shares");
        assert.strictEqual(withdrawLog.args.amount.eq(aliceWithdrawAmount), true, "invalid withdraw amount");
        assert.strictEqual(withdrawLog.args.amount.eq(aliceTomAfterWithdraw.sub(aliceTomBeforeWithdraw)), true, "invalid user amount");

        // withdrawAll bob
        var bobVaultBeforeWithdraw = await this.vault.balanceOf(bob);
        var bobTomBeforeWithdraw = await this.finnBar.balanceOf(bob);

        var withdrawShares = await this.vault.balanceOf(bob);
        var estimateWithdrawTomAmount = await this.estimateShareToTom(withdrawShares);
        var estimateTomBack = estimateWithdrawTomAmount;

        // same as: var receipt = await this.vault.withdraw(withdrawShares, {from: bob});
        var receipt = await this.vault.withdrawAll({from: bob});
        var filterLogs = receipt.logs.filter(v => v.event === "Withdraw");
        var withdrawLog = filterLogs[0];

        var bobVaultAfterWithdraw = await this.vault.balanceOf(bob);
        var bobTomAfterWithdraw = await this.finnBar.balanceOf(bob);

        assert.strictEqual(withdrawLog.args.sender.toLowerCase(), bob.toLowerCase(), "invalid bob withdraw sender");
        assert.strictEqual(withdrawLog.args.shares.eq(withdrawShares), true, "invalid bob withdraw shares");
        assert.strictEqual(withdrawLog.args.shares.eq(bobShares), true, "invalid bob withdraw shares about deposit");
        assert.strictEqual(withdrawLog.args.shares.eq(bobVaultBeforeWithdraw.sub(bobVaultAfterWithdraw)), true, "invalid bob user shares");
        assert.strictEqual(withdrawLog.args.amount.gte(estimateTomBack), true, "invalid bob withdraw amount");
        assert.strictEqual(withdrawLog.args.amount.eq(bobTomAfterWithdraw.sub(bobTomBeforeWithdraw)), true, "invalid bob user amount");

        var vaultTotalSupply = await this.vault.totalSupply();
        var vaultTOM = await this.vault.totalBalance();
        assert.strictEqual(vaultTotalSupply.gt(zero), true, "mTOM totalSupply is 0");
        assert.strictEqual(vaultTotalSupply.eq(new web3.utils.BN(await this.vault.balanceOf(alice))), true, "invalid mTOM balance of alice");
        assert.strictEqual(vaultTOM.gt(zero), true, "TOM deposit to vault is 0");

        // withdrawAll alice
        var poolVaultBalance = await this.vault.available();
        var aliceVaultBeforeWithdraw = await this.vault.balanceOf(alice);
        var aliceTomBeforeWithdraw = await this.finnBar.balanceOf(alice);
        var receipt = await this.vault.withdrawAll({from: alice});
        var filterLogs = receipt.logs.filter(v => v.event === "Withdraw");
        var withdrawLog = filterLogs[0];

        var aliceVaultAfterWithdraw = await this.vault.balanceOf(alice);
        var aliceTomAfterWithdraw = await this.finnBar.balanceOf(alice);

        assert.strictEqual(withdrawLog.args.sender.toLowerCase(), alice.toLowerCase(), "invalid withdrawAll sender");
        assert.strictEqual(withdrawLog.args.shares.eq(aliceVaultBeforeWithdraw), true, "invalid withdrawAll shares");
        assert.strictEqual(withdrawLog.args.shares.eq(aliceVaultBeforeWithdraw.sub(aliceVaultAfterWithdraw)), true, "invalid withdrawAll user shares");
        assert.strictEqual(withdrawLog.args.amount.gt(poolVaultBalance), true, "invalid withdrawAll amount");
        assert.strictEqual(withdrawLog.args.amount.eq(aliceTomAfterWithdraw.sub(aliceTomBeforeWithdraw)), true, "invalid withdrawAll user amount");

        var vaultTotalSupply = await this.vault.totalSupply();
        assert.strictEqual(vaultTotalSupply.eq(zero), true, "mTOM totalSupply should be 0");
    });

    it('multi-deposit and harvest and withdrawShares|withdrawAll success', async () => {
        await this.farm.add('100', this.finnBar.address, true);
        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        var aliceFinnBalance = hundred;
        await this.finnBar.deposit(aliceFinnBalance, {from: alice});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(alice)).eq(aliceFinnBalance), true, "invalid alice amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: alice });

        var bobFinnBalance = hundred;
        await this.finnBar.deposit(bobFinnBalance, {from: bob});
        assert.strictEqual(new web3.utils.BN(await this.finnBar.balanceOf(bob)).eq(bobFinnBalance), true, "invalid bob amount");
        await this.finnBar.approve(this.vault.address, thousandOneDecimals18, { from: bob });

        var aliceDepositAmount = (await this.finnBar.balanceOf(alice)).div(two);
        var bobDepositAmount = (await this.finnBar.balanceOf(bob)).div(two);

        // alice deposit
        var aliceReceipt = await this.vault.deposit(aliceDepositAmount, { from: alice });
        var filterLogs = aliceReceipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var aliceShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid alice deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid alice amount and shares");
        assert.strictEqual(aliceDepositAmount.eq(aliceShares), true, "invalid alice vault amount");

        // bob deposit
        var bobReceipt = await this.vault.deposit(bobDepositAmount, { from: bob });
        var filterLogs = bobReceipt.logs.filter(v => v.event === "Deposit");
        var depositLog = filterLogs[0];
        var depositBlock = await web3.eth.getBlock(depositLog.blockNumber);
        var depositTime = new web3.utils.BN(depositBlock.timestamp);
        var bobShares = new web3.utils.BN(depositLog.args.shares);
        assert.strictEqual(depositTime.eq(new web3.utils.BN(depositLog.args.lastDepositedTime)), true, "invalid bob deposit timestamp");
        assert.strictEqual(new web3.utils.BN(depositLog.args.amount).eq(new web3.utils.BN(depositLog.args.shares)), true, "invalid bob amount and shares");
        assert.strictEqual(bobDepositAmount.eq(bobShares), true, "invalid bob vault amount");

        var startTime = new web3.utils.BN(await this.farm.startTime());
        if ((await time.latest()).lt(startTime)) {
            await time.increaseTo(startTime);
        }

        var farmBalanceTom = new web3.utils.BN(await this.finnBar.balanceOf(this.farm.address));
        assert.strictEqual(farmBalanceTom.eq(aliceDepositAmount.add(bobDepositAmount)), true, "invalid pool tom balance");
        var vaultUserInfo = await this.farm.userInfo(this.autoPid, this.vault.address);
        assert.strictEqual(vaultUserInfo.amount.eq(farmBalanceTom), true, "invalid pool vault amount");

        // update accRewardPerShare
        await this.farm.updatePool(this.autoPid);

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var rewardDuration = await this.actualRewardTime(startTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address));
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(estimateTotalReward.eq(farmPendingTom), true, "invalid pool vault pending reward");
        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

        // harvest
        var receipt = await this.vault.harvest({from: carol});
        var filterLogs = receipt.logs.filter(v => v.event === "Harvest");
        var harvestLog = filterLogs[0];
        var harvestBlock = await web3.eth.getBlock(harvestLog.blockNumber);
        var harvestTime = new web3.utils.BN(harvestBlock.timestamp);
        assert.strictEqual(harvestLog.args.sender.toLowerCase(), carol.toLowerCase(), "invalid harvest sender");
        assert.strictEqual(harvestLog.args.callFee.eq(await this.finnBar.balanceOf(carol)), true, "invalid callFee");
        assert.strictEqual(harvestLog.args.performanceFee.eq(await this.finnBar.balanceOf(treasury)), true, "invalid performanceFee");

        await time.increaseTo((await time.latest()).add(time.duration.seconds(10)));

        // pending reward
        var farmPendingTom = new web3.utils.BN(await this.farm.pendingReward(await this.vault.poolID(), this.vault.address)).add(await this.finn.balanceOf(this.vault.address));
        var rewardDuration = await this.actualRewardTime(harvestTime, (await time.latest()));
        var estimateTotalReward = this.calcFarmPendingReward((await this.farm.finnPerSecond()), rewardDuration)

        var vaultTotalPendingTom = await this.calculateTotalPendingTomDetails();
        var callerReward = vaultTotalPendingTom.totalPending.mul(await this.vault.callFee()).div(this.DENOMINATOR);
        var performanceReward = vaultTotalPendingTom.totalPending.mul(await this.vault.performanceFee()).div(this.DENOMINATOR);

        assert.strictEqual(farmPendingTom.eq(vaultTotalPendingTom.totalPending), true, "invalid vault pending TOM reward");
        assert.strictEqual(vaultTotalPendingTom.callerReward.eq(callerReward), true, "invalid vault pending call fee");
        assert.strictEqual(vaultTotalPendingTom.performanceReward.eq(performanceReward), true, "invalid vault pending performance fee");

        // withdrawShares alice
        var aliceVaultBeforeWithdraw = await this.vault.balanceOf(alice);
        var aliceTomBeforeWithdraw = await this.finnBar.balanceOf(alice);

        var withdrawShares = await this.vault.balanceOf(alice);
        var estimateWithdrawTomAmount = await this.estimateShareToTom(withdrawShares);
        var estimateTomBack = estimateWithdrawTomAmount;

        var receipt = await this.vault.withdrawShares(withdrawShares, {from: alice});
        var filterLogs = receipt.logs.filter(v => v.event === "Withdraw");
        var withdrawLog = filterLogs[0];

        var aliceVaultAfterWithdraw = await this.vault.balanceOf(alice);
        var aliceTomAfterWithdraw = await this.finnBar.balanceOf(alice);

        assert.strictEqual(withdrawLog.args.sender.toLowerCase(), alice.toLowerCase(), "invalid alice withdraw sender");
        assert.strictEqual(withdrawLog.args.shares.eq(withdrawShares), true, "invalid alice withdraw shares");
        assert.strictEqual(withdrawLog.args.shares.eq(aliceShares), true, "invalid alice withdraw shares about deposit");
        assert.strictEqual(withdrawLog.args.shares.eq(aliceVaultBeforeWithdraw.sub(aliceVaultAfterWithdraw)), true, "invalid alice user shares");
        assert.strictEqual(withdrawLog.args.amount.gte(estimateTomBack), true, "invalid alice withdraw amount");
        assert.strictEqual(withdrawLog.args.amount.eq(aliceTomAfterWithdraw.sub(aliceTomBeforeWithdraw)), true, "invalid alice user amount");

        // withdrawAll bob
        var bobVaultBeforeWithdraw = await this.vault.balanceOf(bob);
        var bobTomBeforeWithdraw = await this.finnBar.balanceOf(bob);

        var withdrawShares = await this.vault.balanceOf(bob);
        var estimateWithdrawTomAmount = await this.estimateShareToTom(withdrawShares);
        var estimateTomBack = estimateWithdrawTomAmount;

        // same as: var receipt = await this.vault.withdraw(withdrawShares, {from: bob});
        var receipt = await this.vault.withdrawAll({from: bob});
        var filterLogs = receipt.logs.filter(v => v.event === "Withdraw");
        var withdrawLog = filterLogs[0];

        var bobVaultAfterWithdraw = await this.vault.balanceOf(bob);
        var bobTomAfterWithdraw = await this.finnBar.balanceOf(bob);

        assert.strictEqual(withdrawLog.args.sender.toLowerCase(), bob.toLowerCase(), "invalid bob withdraw sender");
        assert.strictEqual(withdrawLog.args.shares.eq(withdrawShares), true, "invalid bob withdraw shares");
        assert.strictEqual(withdrawLog.args.shares.eq(bobShares), true, "invalid bob withdraw shares about deposit");
        assert.strictEqual(withdrawLog.args.shares.eq(bobVaultBeforeWithdraw.sub(bobVaultAfterWithdraw)), true, "invalid bob user shares");
        assert.strictEqual(withdrawLog.args.amount.gte(estimateTomBack), true, "invalid bob withdraw amount");
        assert.strictEqual(withdrawLog.args.amount.eq(bobTomAfterWithdraw.sub(bobTomBeforeWithdraw)), true, "invalid bob user amount");

        var vaultTOM = await this.vault.available();
        assert.strictEqual(vaultTOM.eq(zero), true, "invalid TOM balance of vault");
    });

});
