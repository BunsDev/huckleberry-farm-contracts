const assert = require('assert');
const { expectRevert, time } = require('@openzeppelin/test-helpers');
const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const Jaunts = artifacts.require("Jaunts");
const MockERC20 = artifacts.require("MockERC20");

contract('Jaunts', ([owner, delegateAdmin, operator, alice, bob, carol]) => {
    const zero = new web3.utils.BN(0);
    const two = new web3.utils.BN(2);
    const three = new web3.utils.BN(3);
    const six = new web3.utils.BN(6);
    const ten = new web3.utils.BN(10);
    const eighteen = new web3.utils.BN(18);
    const thirtyTwo = new web3.utils.BN(32);
    const decimals18 = ten.pow(eighteen);
    const decimals6 = ten.pow(six);
    const totalSupply18 = ten.pow(ten).mul(decimals18);
    const transferAmount18 = ten.pow(three).mul(decimals18);
    const stakeAmount18 = ten.pow(two).mul(decimals18);
    const totalSupply6 = ten.pow(ten).mul(decimals6);
    const stakeAmount6 = ten.pow(two).mul(decimals6);

    const startDuration = time.duration.hours(10);
    const workDuration = time.duration.days(1);

    const rewardPerSecond18 = ten.pow(eighteen);
    const rewardPerSecond6 = ten.pow(six);
    const totalReward18 = workDuration.mul(rewardPerSecond18);
    const totalReward6 = workDuration.mul(rewardPerSecond6);
    const zeroAddress = "0x0000000000000000000000000000000000000000";

    let pools = [];
    let stake;
    let baseTime;
    let startTime;
    let endTime;
    let resetExpiredPool;
    let actualRewardTime;
    let pendingReward;
    let actualWorkTime;

    // beforeEach(async () => {
    before(async () => {
        stake = await Jaunts.new();

        // initialize stake contract
        await stake.initialize(delegateAdmin, operator, {from: owner});

        // deploy lp token
        let lp18 = await MockERC20.new("Test LP Token 18", "LP18", 18, totalSupply18, {from: owner}); // 10000000000 LP18
        await lp18.transfer(alice, transferAmount18, {from: owner}); // 1000 LP18
        await lp18.transfer(bob, transferAmount18, {from: owner}); // 1000 LP18

        // deploy lp token
        let lpM18 = await MockERC20.new("Test LP Token For MOVR 18", "LPM18", 18, totalSupply18, {from: owner}); // 10000000000 LP18
        await lpM18.transfer(alice, transferAmount18, {from: owner}); // 1000 LPM18
        await lpM18.transfer(bob, transferAmount18, {from: owner}); // 1000 LPM18

        // deploy reward token TST18 and TST6
        let token18 = await MockERC20.new("Test Token 18", "TST18", 18, totalSupply18, {from: owner}); // 10000000000 TST18

        let token6 = await MockERC20.new("Test Token 6", "TST6", 6, totalSupply6, {from: owner}); // 10000000000 TST6

        let tokenM6 = await MockERC20.new("Test Token For MOVR 6", "TSTM6", 6, totalSupply6, {from: owner}); // 10000000000 TST6

        // pool 0 config --- reward token decimals is 18
        baseTime = await time.latest();
        startTime = baseTime.add(startDuration);
        endTime = startTime.add(workDuration);
        pools.push({
            lpToken: lp18,
            rewardToken: token18,
            startTime:startTime,
            endTime: endTime,
            rewardPerSecond: rewardPerSecond18,
            totalReward: totalReward18,
        });

        // pool 1 config --- reward token decimals is 6
        pools.push({
            lpToken: lp18,
            rewardToken: token6,
            startTime:startTime,
            endTime: endTime,
            rewardPerSecond: rewardPerSecond6,
            totalReward: totalReward6,
        });

        startTime = baseTime.add(endTime);
        endTime = startTime.add(workDuration);
        const zeroAccount = {address: zeroAddress};
        // pool 2 config --- reward token is MOVR
        pools.push({
            lpToken: lpM18,
            rewardToken: zeroAccount,
            startTime:startTime,
            endTime: endTime,
            rewardPerSecond: rewardPerSecond18,
            totalReward: totalReward18,
        });

        // pool 3 config --- stake token is MOVR
        pools.push({
            lpToken: zeroAccount,
            rewardToken: tokenM6,
            startTime:startTime,
            endTime: endTime,
            rewardPerSecond: rewardPerSecond6,
            totalReward: totalReward6,
        });

        resetExpiredPool = async function(pool, startDelaySecond) {
            let now = await time.latest();
            // if (now.gte(pool.endTime)) {
                pool.startTime = now.add(time.duration.seconds(startDelaySecond));
                pool.endTime = pool.startTime.add(workDuration);
            // }
        }

        actualRewardTime = function(pool, depositTime, claimTime) {
            if (depositTime.gt(pool.endTime) || claimTime.lt(pool.startTime)) {
                return zero;
            }
            if (depositTime.gte(claimTime)) {
                throw new Error("deposit is later than reward");
            }
            if (depositTime.lt(pool.startTime)) {
                depositTime = pool.startTime;
            }
            if (claimTime.gt(pool.endTime)) {
                claimTime = pool.endTime;
            }
            return claimTime.sub(depositTime);
        }

        pendingReward = async function (pid, user) {
            let pending = await stake.pendingReward(pid, user);
            return pending[1];
        }

        actualWorkTime = async function () {
            let baseTime = await time.latest();
            let startTime = baseTime.add(startDuration);
            let endTime = startTime.add(workDuration);
            return {startTime:startTime, endTime:endTime};
        }
    });

    it('add pool by non-operator', async () => {
        await expectRevert(stake.add(pools[0].lpToken.address, pools[0].rewardToken.address, pools[0].startTime, pools[0].endTime, pools[0].rewardPerSecond, {from: alice}), 'not operator');
    });

    it('duplicate initialization', async () => {
        await expectRevert(stake.initialize(delegateAdmin, operator, {from: owner}), 'Initializable: contract is already initialized');
    });

    it('update operator', async () => {
        let OPERATOR_ROLE = await stake.OPERATOR_ROLE();
        await stake.revokeRole(OPERATOR_ROLE, operator, {from: delegateAdmin});
        assert.strictEqual((await stake.hasRole(OPERATOR_ROLE, operator)), false, "revoke operator failed");

        await stake.grantRole(OPERATOR_ROLE, delegateAdmin, {from: delegateAdmin});
        assert.strictEqual((await stake.hasRole(OPERATOR_ROLE, delegateAdmin)), true, "grant admin to operator failed");

        await stake.revokeRole(OPERATOR_ROLE, delegateAdmin, {from: delegateAdmin});
        assert.strictEqual((await stake.hasRole(OPERATOR_ROLE, delegateAdmin)), false, "revoke admin to operator failed");

        await stake.grantRole(OPERATOR_ROLE, operator, {from: delegateAdmin});
        assert.strictEqual((await stake.hasRole(OPERATOR_ROLE, operator)), true, "reset operator failed");
    });

    it('add pool with reward token decimals 18', async () => {
        let confPid = 0;
        let pid = await stake.poolLength();
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.lpToken, pools[confPid].lpToken.address, `invalid pool ${confPid} lpToken`);
        assert.strictEqual(pInfo.rewardToken, pools[confPid].rewardToken.address, `invalid pool ${confPid} rewardToken`);
        assert.strictEqual(pInfo.bonusStartTimestamp.eq(pools[confPid].startTime), true, `invalid pool ${confPid} startTime`);
        assert.strictEqual(pInfo.bonusEndTimestamp.eq(pools[confPid].endTime), true, `invalid pool ${confPid} endTime`);
        assert.strictEqual(pInfo.rewardPerSecond.eq(pools[confPid].rewardPerSecond), true, `invalid pool ${confPid} rewardPerSecond`);
    });

    it('add pool with reward token decimals 6', async () => {
        let confPid = 1;
        let pid = await stake.poolLength();
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.lpToken, pools[confPid].lpToken.address, `invalid pool ${confPid} lpToken`);
        assert.strictEqual(pInfo.rewardToken, pools[confPid].rewardToken.address, `invalid pool ${confPid} rewardToken`);
        assert.strictEqual(pInfo.bonusStartTimestamp.eq(pools[confPid].startTime), true, `invalid pool ${confPid} startTime`);
        assert.strictEqual(pInfo.bonusEndTimestamp.eq(pools[confPid].endTime), true, `invalid pool ${confPid} endTime`);
        assert.strictEqual(pInfo.rewardPerSecond.eq(pools[confPid].rewardPerSecond), true, `invalid pool ${confPid} rewardPerSecond`);
    });

    it('set pool', async () => {
        let confPid = 0;
        let pid = await stake.poolLength();
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});
        var pOldInfo = await stake.poolInfo(pid);
        await stake.set(pid, pools[confPid].rewardPerSecond.mul(two), pools[confPid].endTime.mul(two), {from: operator});
        var pNewInfo = await stake.poolInfo(pid);
        assert.strictEqual(pOldInfo.rewardPerSecond.eq(pNewInfo.rewardPerSecond), false, `invalid pool ${confPid} rewardPerSecond`);
        assert.strictEqual(pOldInfo.bonusEndTimestamp.eq(pNewInfo.bonusStartTimestamp), false, `invalid ${confPid} pool endTime`);
    });

    it('deposit pool which not exists', async () => {
        let confPid = 0;
        let pid = Number(await stake.poolLength());
        await pools[confPid].lpToken.approve(stake.address, stakeAmount18, {from: alice});
        await expectRevert(stake.deposit(pid, stakeAmount18, {from: alice}), `invalid pid`);
    });

    it('deposit 0 success', async () => {
        let confPid = 0;
        let pid = Number(await stake.poolLength());
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});
        await pools[confPid].lpToken.approve(stake.address, zero, {from: alice});
        await stake.deposit(pid, zero, {from: alice});
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(zero), true, `invalid pool ${confPid} currentSupply`);
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(zero), true, `invalid pool ${confPid} user amount`);
    });

    it('not deposit and withdraw 0 success', async () => {
        let confPid = 0;
        let pid = Number(await stake.poolLength());
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});
        await stake.withdraw(pid, zero, {from: alice});
    });

    it('decimals 18 and deposit success', async () => {
        let confPid = 0;
        let pid = Number(await stake.poolLength());
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});
        await pools[confPid].lpToken.approve(stake.address, stakeAmount18, {from: alice});
        await stake.deposit(pid, stakeAmount18, {from: alice});
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(stakeAmount18), true, "invalid pool currentSupply");
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(stakeAmount18), true, "invalid pool user amount");
    });

    it('decimals 18 and deposit 0 success', async () => {
        let confPid = 0;
        let pid = Number(await stake.poolLength());
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});

        await resetExpiredPool(pools[confPid], startDuration);
        if ((await time.latest()).lt(pools[confPid].startTime)) {
            await time.increaseTo(pools[confPid].startTime);
        }

        let aliceBeforeRewardBalance = await pools[confPid].rewardToken.balanceOf(alice);

        let rewardTokenBalance = await pools[confPid].rewardToken.balanceOf(stake.address);
        if (!rewardTokenBalance.eq(totalReward18)) {
            await pools[confPid].rewardToken.transfer(stake.address, totalReward18.sub(rewardTokenBalance), {from: owner});
        }
        assert.strictEqual((await pools[confPid].rewardToken.balanceOf(stake.address)).eq(totalReward18), true, "invalid pool reward token balance");

        await pools[confPid].lpToken.approve(stake.address, stakeAmount18, {from: alice});
        let depositReceipt = await stake.deposit(pid, stakeAmount18, {from: alice});
        let depositLogs = depositReceipt.logs.filter(v => v.event === "Deposit");
        let depositBlock = await web3.eth.getBlock(depositLogs[0].blockNumber);
        let depositTime = new web3.utils.BN(depositBlock.timestamp);
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(stakeAmount18), true, "invalid pool currentSupply");
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(stakeAmount18), true, "invalid pool user amount");

        await time.increase(time.duration.seconds(10));

        let claimReceipt = await stake.deposit(pid, zero, {from: alice});
        let claimLogs = claimReceipt.logs.filter(v => v.event === "Deposit");
        let claimBlock = await web3.eth.getBlock(claimLogs[0].blockNumber);
        let claimTime = new web3.utils.BN(claimBlock.timestamp);

        let aliceRewardBalance = (await pools[confPid].rewardToken.balanceOf(alice)).sub(aliceBeforeRewardBalance);
        let currentTotalReward = pools[confPid].rewardPerSecond.mul(actualRewardTime(pools[confPid], depositTime, claimTime));
        assert.strictEqual((aliceRewardBalance).eq(currentTotalReward), true, "invalid pool alice reward");

        if ((await time.latest()).lte(pools[confPid].endTime)) {
            await time.increaseTo(pools[confPid].endTime.add(time.duration.seconds(1)));
        }

        await stake.withdraw(pid, stakeAmount18, {from: alice});
    });

    it('decimals 18 and withdraw 0 success', async () => {
        let confPid = 0;
        let pid = Number(await stake.poolLength());

        await resetExpiredPool(pools[confPid], startDuration);
        if ((await time.latest()).lt(pools[confPid].startTime)) {
            await time.increaseTo(pools[confPid].startTime);
        }
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});

        let aliceBeforeRewardBalance = await pools[confPid].rewardToken.balanceOf(alice);
        let rewardTokenBalance = await pools[confPid].rewardToken.balanceOf(stake.address);
        if (!rewardTokenBalance.eq(totalReward18)) {
            await pools[confPid].rewardToken.transfer(stake.address, totalReward18.sub(rewardTokenBalance), {from: owner});
        }
        assert.strictEqual((await pools[confPid].rewardToken.balanceOf(stake.address)).eq(totalReward18), true, "invalid pool reward token balance");

        await pools[confPid].lpToken.approve(stake.address, stakeAmount18, {from: alice});
        let depositReceipt = await stake.deposit(pid, stakeAmount18, {from: alice});
        let depositLogs = depositReceipt.logs.filter(v => v.event === "Deposit");
        let depositBlock = await web3.eth.getBlock(depositLogs[0].blockNumber);
        let depositTime = new web3.utils.BN(depositBlock.timestamp);
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(stakeAmount18), true, "invalid pool currentSupply");
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(stakeAmount18), true, "invalid pool user amount");

        await time.increase(time.duration.seconds(10));

        let withdrawReceipt = await stake.withdraw(pid, zero, {from: alice});
        let withdrawLogs = withdrawReceipt.logs.filter(v => v.event === "Withdraw");
        let withDrawBlock = await web3.eth.getBlock(withdrawLogs[0].blockNumber);
        let withdrawTime = new web3.utils.BN(withDrawBlock.timestamp);
        // let currentTotalReward = pools[confPid].rewardPerSecond.mul(withdrawTime.sub(depositTime));
        let currentTotalReward = pools[confPid].rewardPerSecond.mul(actualRewardTime(pools[confPid], depositTime, withdrawTime));
        let aliceRewardBalance = (await pools[confPid].rewardToken.balanceOf(alice)).sub(aliceBeforeRewardBalance);

        assert.strictEqual((aliceRewardBalance).eq(currentTotalReward), true, "invalid pool alice reward");
    });

    it('decimals 18 and withdraw success', async () => {
        let confPid = 0;
        let pid = Number(await stake.poolLength());

        await resetExpiredPool(pools[confPid], startDuration);
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});

        let aliceBeforeRewardBalance = await pools[confPid].rewardToken.balanceOf(alice);
        let rewardTokenBalance = await pools[confPid].rewardToken.balanceOf(stake.address);
        if (!rewardTokenBalance.eq(totalReward18)) {
            await pools[confPid].rewardToken.transfer(stake.address, totalReward18.sub(rewardTokenBalance), {from: owner});
        }
        assert.strictEqual((await pools[confPid].rewardToken.balanceOf(stake.address)).eq(totalReward18), true, "invalid pool reward token balance");

        await pools[confPid].lpToken.approve(stake.address, stakeAmount18, {from: alice});
        let depositReceipt = await stake.deposit(pid, stakeAmount18, {from: alice});
        let depositLogs = depositReceipt.logs.filter(v => v.event === "Deposit");
        let depositBlock = await web3.eth.getBlock(depositLogs[0].blockNumber);
        let depositTime = new web3.utils.BN(depositBlock.timestamp);
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(stakeAmount18), true, "invalid pool currentSupply");
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(stakeAmount18), true, "invalid pool user amount");

        await time.increaseTo(pools[confPid].startTime.add(time.duration.seconds(10)));
        let rewardDuration = actualRewardTime(pools[confPid], depositTime, (await time.latest()));
        let rewardValue = pools[confPid].rewardPerSecond.mul(time.duration.seconds(rewardDuration));
        assert.strictEqual((await pendingReward(pid, alice)).eq(rewardValue), true, "invalid pool user pending reward");
        // assert.strictEqual((await stake.pendingReward(pid, alice)).eq(rewardValue), true, "invalid pool user pending reward");

        await time.increaseTo(pools[confPid].endTime);

        let withdrawReceipt = await stake.withdraw(pid, stakeAmount18, {from: alice});
        let withdrawLogs = withdrawReceipt.logs.filter(v => v.event === "Withdraw");
        let withDrawBlock = await web3.eth.getBlock(withdrawLogs[0].blockNumber);
        let withdrawTime = new web3.utils.BN(withDrawBlock.timestamp);
        let currentTotalReward = pools[confPid].rewardPerSecond.mul(actualRewardTime(pools[confPid], depositTime, withdrawTime));
        let aliceRewardBalance = (await pools[confPid].rewardToken.balanceOf(alice)).sub(aliceBeforeRewardBalance);

        assert.strictEqual((aliceRewardBalance).eq(currentTotalReward), true, "invalid pool alice reward");
        assert.strictEqual((currentTotalReward).eq(pools[confPid].totalReward), true, "invalid pool alice reward");
    });

    it('decimals 6 and deposit and deposit 0 success', async () => {
        let confPid = 1;
        let pid = Number(await stake.poolLength());

        await resetExpiredPool(pools[confPid], startDuration);
        if ((await time.latest()).lt(pools[confPid].startTime)) {
            await time.increaseTo(pools[confPid].startTime);
        }
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});

        let aliceBeforeRewardBalance = await pools[confPid].rewardToken.balanceOf(alice);
        await pools[confPid].rewardToken.transfer(stake.address, totalReward6, {from: owner});
        assert.strictEqual((await pools[confPid].rewardToken.balanceOf(stake.address)).eq(totalReward6), true, "invalid pool reward token balance");

        await pools[confPid].lpToken.approve(stake.address, stakeAmount6, {from: alice});
        let depositReceipt = await stake.deposit(pid, stakeAmount6, {from: alice});
        let depositLogs = depositReceipt.logs.filter(v => v.event === "Deposit");
        let depositBlock = await web3.eth.getBlock(depositLogs[0].blockNumber);
        let depositTime = new web3.utils.BN(depositBlock.timestamp);
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(stakeAmount6), true, "invalid pool currentSupply");
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(stakeAmount6), true, "invalid pool user amount");

        await time.increase(time.duration.seconds(10));

        let claimReceipt = await stake.deposit(pid, zero, {from: alice});
        let claimLogs = claimReceipt.logs.filter(v => v.event === "Deposit");
        let claimBlock = await web3.eth.getBlock(claimLogs[0].blockNumber);
        let claimTime = new web3.utils.BN(claimBlock.timestamp);
        let currentTotalReward = pools[confPid].rewardPerSecond.mul(actualRewardTime(pools[confPid], depositTime, claimTime));
        let aliceRewardBalance = (await pools[confPid].rewardToken.balanceOf(alice)).sub(aliceBeforeRewardBalance);
        assert.strictEqual((aliceRewardBalance).eq(currentTotalReward), true, "invalid pool alice reward");
    });

    it('decimals 6 and withdraw 0 success', async () => {
        let confPid = 1;
        let pid = Number(await stake.poolLength());

        await resetExpiredPool(pools[confPid], startDuration);
        if ((await time.latest()).lt(pools[confPid].startTime)) {
            await time.increaseTo(pools[confPid].startTime);
        }
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});

        await resetExpiredPool(pools[confPid], startDuration);
        if ((await time.latest()).lt(pools[confPid].startTime)) {
            await time.increaseTo(pools[confPid].startTime);
        }
        let aliceBeforeRewardBalance = await pools[confPid].rewardToken.balanceOf(alice);
        await pools[confPid].rewardToken.transfer(stake.address, totalReward6, {from: owner});
        // assert.strictEqual((await pools[confPid].rewardToken.balanceOf(stake.address)).eq(totalReward6), true, "invalid pool reward token balance");

        await pools[confPid].lpToken.approve(stake.address, stakeAmount6, {from: alice});
        let depositReceipt = await stake.deposit(pid, stakeAmount6, {from: alice});
        let depositLogs = depositReceipt.logs.filter(v => v.event === "Deposit");
        let depositBlock = await web3.eth.getBlock(depositLogs[0].blockNumber);
        let depositTime = new web3.utils.BN(depositBlock.timestamp);
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(stakeAmount6), true, "invalid pool currentSupply");
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(stakeAmount6), true, "invalid pool user amount");

        await time.increase(time.duration.seconds(10));

        let withdrawReceipt = await stake.withdraw(pid, zero, {from: alice});
        let withdrawLogs = withdrawReceipt.logs.filter(v => v.event === "Withdraw");
        let withDrawBlock = await web3.eth.getBlock(withdrawLogs[0].blockNumber);
        let withdrawTime = new web3.utils.BN(withDrawBlock.timestamp);
        // let currentTotalReward = pools[confPid].rewardPerSecond.mul(withdrawTime.sub(depositTime));
        let currentTotalReward = pools[confPid].rewardPerSecond.mul(actualRewardTime(pools[confPid], depositTime, withdrawTime));
        let aliceRewardBalance = (await pools[confPid].rewardToken.balanceOf(alice)).sub(aliceBeforeRewardBalance);
        assert.strictEqual((aliceRewardBalance).eq(currentTotalReward), true, "invalid pool alice reward");
    });

    it('decimals 6 and withdraw success', async () => {
        let confPid = 1;
        let pid = Number(await stake.poolLength());

        await resetExpiredPool(pools[confPid], startDuration);
        if ((await time.latest()).lt(pools[confPid].startTime)) {
            await time.increaseTo(pools[confPid].startTime);
        }
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});

        await resetExpiredPool(pools[confPid], startDuration);
        if ((await time.latest()).lt(pools[confPid].startTime)) {
            await time.increaseTo(pools[confPid].startTime);
        }
        let aliceBeforeRewardBalance = await pools[confPid].rewardToken.balanceOf(alice);
        await pools[confPid].rewardToken.transfer(stake.address, totalReward6, {from: owner});
        // assert.strictEqual((await pools[confPid].rewardToken.balanceOf(stake.address)).eq(totalReward6), true, "invalid pool reward token balance");

        await pools[confPid].lpToken.approve(stake.address, stakeAmount6, {from: alice});
        let depositReceipt = await stake.deposit(pid, stakeAmount6, {from: alice});
        let depositLogs = depositReceipt.logs.filter(v => v.event === "Deposit");
        let depositBlock = await web3.eth.getBlock(depositLogs[0].blockNumber);
        let depositTime = new web3.utils.BN(depositBlock.timestamp);
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(stakeAmount6), true, "invalid pool currentSupply");
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(stakeAmount6), true, "invalid pool user amount");

        await time.increase(time.duration.seconds(10));

        let withdrawReceipt = await stake.withdraw(pid, stakeAmount6, {from: alice});
        let withdrawLogs = withdrawReceipt.logs.filter(v => v.event === "Withdraw");
        let withDrawBlock = await web3.eth.getBlock(withdrawLogs[0].blockNumber);
        let withdrawTime = new web3.utils.BN(withDrawBlock.timestamp);
        // let currentTotalReward = pools[confPid].rewardPerSecond.mul(withdrawTime.sub(depositTime));
        let currentTotalReward = pools[confPid].rewardPerSecond.mul(actualRewardTime(pools[confPid], depositTime, withdrawTime));
        let aliceRewardBalance = (await pools[confPid].rewardToken.balanceOf(alice)).sub(aliceBeforeRewardBalance);
        assert.strictEqual((aliceRewardBalance).eq(currentTotalReward), true, "invalid pool alice reward");
    });

    it('deposit pool with MOVR as reward token success', async () => {
        let confPid = 2;
        let pid = await stake.poolLength();
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.lpToken, pools[confPid].lpToken.address, `invalid pool ${confPid} lpToken`);
        assert.strictEqual(pInfo.rewardToken, pools[confPid].rewardToken.address, `invalid pool ${confPid} rewardToken`);
        assert.strictEqual(pInfo.bonusStartTimestamp.eq(pools[confPid].startTime), true, `invalid pool ${confPid} startTime`);
        assert.strictEqual(pInfo.bonusEndTimestamp.eq(pools[confPid].endTime), true, `invalid pool ${confPid} endTime`);
        assert.strictEqual(pInfo.rewardPerSecond.eq(pools[confPid].rewardPerSecond), true, `invalid pool ${confPid} rewardPerSecond`);
        await pools[confPid].lpToken.approve(stake.address, zero, {from: alice});
        await stake.deposit(pid, zero, {from: alice});
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(zero), true, `invalid pool ${confPid} currentSupply`);
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(zero), true, `invalid pool ${confPid} user amount`);
    });

    it('not deposit and withdraw pool with MOVR as reward token success', async () => {
        let confPid = 2;
        let pid = Number(await stake.poolLength());
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});
        await stake.withdraw(pid, zero, {from: alice});
    });

    it('deposit and withdraw pool with MOVR as reward token success', async () => {
        let confPid = 2;
        let pid = Number(await stake.poolLength());

        await resetExpiredPool(pools[confPid], startDuration);
        if ((await time.latest()).lt(pools[confPid].startTime)) {
            await time.increaseTo(pools[confPid].startTime);
        }
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});

        let rewardTokenBalance = new web3.utils.BN(await web3.eth.getBalance(stake.address));
        if (!rewardTokenBalance.eq(totalReward18)) {
            await web3.eth.sendTransaction({from: owner, to: stake.address, value: totalReward18.sub(rewardTokenBalance)}, {from: owner});
        }
        assert.strictEqual(new web3.utils.BN(await web3.eth.getBalance(stake.address)).eq(totalReward18), true, "invalid pool reward token balance");
        let stakeRewardMOVR = new web3.utils.BN(await web3.eth.getBalance(stake.address));

        let aliceBeforeRewardBalance = new web3.utils.BN(await web3.eth.getBalance(alice));
        let approveReceipt = await pools[confPid].lpToken.approve(stake.address, stakeAmount18, {from: alice});
        let approveTx = await web3.eth.getTransaction(approveReceipt.tx);
        let approveGasCost = new web3.utils.BN(approveReceipt.receipt.gasUsed).mul(new web3.utils.BN(approveTx.gas));

        let depositReceipt = await stake.deposit(pid, stakeAmount18, {from: alice});
        let depositTx = await web3.eth.getTransaction(depositReceipt.tx);
        let depositGasCost = new web3.utils.BN(depositReceipt.receipt.gasUsed).mul(new web3.utils.BN(depositTx.gas));

        let depositLogs = depositReceipt.logs.filter(v => v.event === "Deposit");
        let depositBlock = await web3.eth.getBlock(depositLogs[0].blockNumber);
        let depositTime = new web3.utils.BN(depositBlock.timestamp);
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(stakeAmount18), true, "invalid pool currentSupply");
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(stakeAmount18), true, "invalid pool user amount");

        await time.increase(time.duration.seconds(10));

        let withdrawReceipt = await stake.withdraw(pid, zero, {from: alice});
        let withdrawTx = await web3.eth.getTransaction(withdrawReceipt.tx);
        let withdrawGasCost = new web3.utils.BN(withdrawReceipt.receipt.gasUsed).mul(new web3.utils.BN(withdrawTx.gas));

        let withdrawLogs = withdrawReceipt.logs.filter(v => v.event === "Withdraw");
        let withDrawBlock = await web3.eth.getBlock(withdrawLogs[0].blockNumber);
        let withdrawTime = new web3.utils.BN(withDrawBlock.timestamp);
        let currentTotalReward = pools[confPid].rewardPerSecond.mul(actualRewardTime(pools[confPid], depositTime, withdrawTime));
        // let aliceRewardBalance = (new web3.utils.BN(await web3.eth.getBalance(alice)))
        //     .sub(aliceBeforeRewardBalance)
        //     .add(approveGasCost)
        //     .add(depositGasCost)
        //     .add(withdrawGasCost)
        // ;

        // console.log("aliceRewardBalance:", aliceRewardBalance.toString(10))
        // console.log("currentTotalReward:", currentTotalReward.toString(10))

        // let range = aliceRewardBalance.mul(new web3.utils.BN(5)).div(new web3.utils.BN(100));
        // assert.strictEqual((aliceRewardBalance.sub(range)).lte(currentTotalReward) && (aliceRewardBalance.add(range)).gte(currentTotalReward), true, "invalid pool alice reward");
        let stakeWithdrawMOVR = new web3.utils.BN(await web3.eth.getBalance(stake.address));
        assert.strictEqual(stakeRewardMOVR.sub(stakeWithdrawMOVR).eq(currentTotalReward), true, "invalid user withdraw reward amount");

    });

    it('deposit pool with MOVR as lp token success', async () => {
        stake = await Jaunts.new();
        // initialize stake contract
        await stake.initialize(delegateAdmin, operator, {from: owner});

        let confPid = 3;
        let pid = await stake.poolLength();
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.lpToken, pools[confPid].lpToken.address, `invalid pool ${confPid} lpToken`);
        assert.strictEqual(pInfo.rewardToken, pools[confPid].rewardToken.address, `invalid pool ${confPid} rewardToken`);
        assert.strictEqual(pInfo.bonusStartTimestamp.eq(pools[confPid].startTime), true, `invalid pool ${confPid} startTime`);
        assert.strictEqual(pInfo.bonusEndTimestamp.eq(pools[confPid].endTime), true, `invalid pool ${confPid} endTime`);
        assert.strictEqual(pInfo.rewardPerSecond.eq(pools[confPid].rewardPerSecond), true, `invalid pool ${confPid} rewardPerSecond`);
        await stake.deposit(pid, zero, {from: alice});
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(zero), true, `invalid pool ${confPid} currentSupply`);
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(zero), true, `invalid pool ${confPid} user amount`);
    });

    it('not deposit and withdraw pool with MOVR as lp token success', async () => {
        let confPid = 3;
        let pid = Number(await stake.poolLength());
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});
        await stake.withdraw(pid, zero, {from: alice});
    });

    it('deposit and withdraw pool with MOVR as lp token success', async () => {
        let confPid = 3;
        let pid = Number(await stake.poolLength());
        let workTime = await actualWorkTime();
        pools[confPid].startTime = workTime.startTime;
        pools[confPid].endTime = workTime.endTime;
        await stake.add(pools[confPid].lpToken.address, pools[confPid].rewardToken.address, pools[confPid].startTime, pools[confPid].endTime, pools[confPid].rewardPerSecond, {from: operator});

        await resetExpiredPool(pools[confPid], startDuration);
        if ((await time.latest()).lt(pools[confPid].startTime)) {
            await time.increaseTo(pools[confPid].startTime);
        }

        let aliceBeforeRewardBalance = await pools[confPid].rewardToken.balanceOf(alice);

        let rewardTokenBalance = await pools[confPid].rewardToken.balanceOf(stake.address);
        if (!rewardTokenBalance.eq(totalReward6)) {
            await pools[confPid].rewardToken.transfer(stake.address, totalReward6.sub(rewardTokenBalance), {from: owner});
        }
        assert.strictEqual((await pools[confPid].rewardToken.balanceOf(stake.address)).eq(totalReward6), true, "invalid pool reward token balance");

        let stakeInitBalance = new web3.utils.BN(await web3.eth.getBalance(stake.address));
        let depositReceipt = await stake.deposit(pid, stakeAmount6, {value:stakeAmount6, from: alice});
        let depositLogs = depositReceipt.logs.filter(v => v.event === "Deposit");
        let depositBlock = await web3.eth.getBlock(depositLogs[0].blockNumber);
        let depositTime = new web3.utils.BN(depositBlock.timestamp);
        var pInfo = await stake.poolInfo(pid);
        assert.strictEqual(pInfo.currentSupply.eq(stakeAmount6), true, "invalid pool currentSupply");
        var aliceInfo = await stake.userInfo(pid, alice);
        assert.strictEqual(aliceInfo.amount.eq(stakeAmount6), true, "invalid pool user amount");
        let stakeDepositMOVR = new web3.utils.BN(await web3.eth.getBalance(stake.address));
        assert.strictEqual(stakeDepositMOVR.sub(stakeInitBalance).eq(stakeAmount6), true, "invalid user deposit stake amount");

        await time.increase(time.duration.seconds(10));

        let claimReceipt = await stake.deposit(pid, zero, {from: alice});
        let claimLogs = claimReceipt.logs.filter(v => v.event === "Deposit");
        let claimBlock = await web3.eth.getBlock(claimLogs[0].blockNumber);
        let claimTime = new web3.utils.BN(claimBlock.timestamp);

        let aliceRewardBalance = (await pools[confPid].rewardToken.balanceOf(alice)).sub(aliceBeforeRewardBalance);
        let currentTotalReward = pools[confPid].rewardPerSecond.mul(actualRewardTime(pools[confPid], depositTime, claimTime));
        assert.strictEqual((aliceRewardBalance).eq(currentTotalReward), true, "invalid pool alice reward");

        if ((await time.latest()).lte(pools[confPid].endTime)) {
            await time.increaseTo(pools[confPid].endTime.add(time.duration.seconds(1)));
        }

        await stake.withdraw(pid, stakeAmount6, {from: alice});

        let stakeWithdrawMOVR = new web3.utils.BN(await web3.eth.getBalance(stake.address));
        assert.strictEqual(stakeWithdrawMOVR.eq(stakeInitBalance), true, "invalid user withdraw stake amount");
    });

});
