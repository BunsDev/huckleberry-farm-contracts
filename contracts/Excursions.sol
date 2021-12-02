// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/Initializable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

interface IWMOVR {
    function deposit() external payable;
    function withdraw(uint) external;
}

contract Excursions is Initializable, AccessControl {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR");

    // Info of each user.
    struct UserInfo {
        uint256 amount;     // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
        //
        // We do some fancy math here. Basically, any point in time, the amount of wanWans
        // entitled to a user but is pending to be distributed is:
        //
        //   pending reward = (user.amount * pool.accRewardPerShare) - user.rewardDebt
        //
        // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
        //   1. The pool's `accRewardPerShare` (and `lastRewardTimestamp`) gets updated.
        //   2. User receives the pending reward sent to his/her address.
        //   3. User's `amount` gets updated.
        //   4. User's `rewardDebt` gets updated.
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20  lpToken;          // Address of LP token contract.
        IERC20  rewardToken;      // token address for reward

        uint256 currentSupply;   //
        uint256 bonusStartTimestamp;  //
        uint256 bonusEndTimestamp;    // Block number when bonus period ends.

        uint256 lastRewardTimestamp;  // Last block number that reward distribution occurs.
        uint256 accRewardPerShare;// Accumulated reward per share, times 1e12 or 1e32. See below.
        uint256 rewardPerSecond;   // tokens reward per block.
    }

    IWMOVR public wmovr;            // The WMOVR contract
    PoolInfo[] public poolInfo;   // Info of each pool.
    mapping (uint256 => mapping (address => UserInfo)) public userInfo;// Info of each user that stakes LP tokens.
    mapping (address => bool) public isCollateral;
    
    event Add(uint256 indexed pid, address indexed lpToken, address indexed rewardToken, uint256 startTime, uint256 endTime, uint256 rewardPerSecond);
    event Set(uint256 indexed pid, uint256 endTime, uint256 rewardPerSecond);
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);

    modifier onlyOperator() {
        require(hasRole(OPERATOR_ROLE, msg.sender), "not operator");
        _;
    }

    modifier onlyValidPool(uint256 _pid) {
        require(_pid < poolInfo.length,"invalid pid");
        _;
    }

    function initialize(address admin, address operator, IWMOVR _wmovr)
        external
        initializer
    {
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _setupRole(OPERATOR_ROLE, operator);
        wmovr = _wmovr;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // XXX DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function add(address _lpToken, address _rewardToken, uint256 _startTime, uint256 _endTime, uint256 _rewardPerSecond)
        external
        onlyOperator
    {
        require(block.timestamp < _endTime, "invalid end time");
        require(_startTime < _endTime, "invalid start time");
        require(_lpToken != address(0), "invalid lp");
        require(_rewardToken != address(0), "invalid reward token");
        require(_rewardToken != _lpToken, "reward token cannot be same with lpToken");
        require(!isCollateral(_rewardToken), "collateral cannot use for reward");
        isCollateral[_lpToken] = true;

        poolInfo.push(PoolInfo({
            lpToken: IERC20(_lpToken),
            rewardToken: IERC20(_rewardToken),
            currentSupply: 0,
            bonusStartTimestamp: _startTime,
            bonusEndTimestamp: _endTime,
            lastRewardTimestamp: block.timestamp > _startTime ? block.timestamp : _startTime,
            accRewardPerShare: 0,
            rewardPerSecond: _rewardPerSecond
        }));
        emit Add((poolInfo.length - 1), _lpToken, _rewardToken, _startTime, _endTime, _rewardPerSecond);
    }

    // Update the given pool's. Can only be called by the owner.
    function set(uint256 _pid, uint256 _rewardPerSecond, uint256 _endTime)
        external
        onlyOperator
    {
        updatePool(_pid);
        poolInfo[_pid].rewardPerSecond = _rewardPerSecond;
        poolInfo[_pid].bonusEndTimestamp = _endTime;

        emit Set(_pid, _rewardPerSecond, _endTime);
    }

    // Update reward vairables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.timestamp <= pool.lastRewardTimestamp) {
            return;
        }

        if (pool.currentSupply == 0) {
            pool.lastRewardTimestamp = block.timestamp;
            return;
        }

        uint256 multiplier = getMultiplier(pool.lastRewardTimestamp, block.timestamp, pool.bonusStartTimestamp, pool.bonusEndTimestamp);
        uint256 tokenReward = multiplier.mul(pool.rewardPerSecond);
        pool.accRewardPerShare = pool.accRewardPerShare.add(tokenReward.mul(1e32).div(pool.currentSupply));
        pool.lastRewardTimestamp = block.timestamp;
    }

    function deposit(uint256 _pid, uint256 _amount) external onlyValidPool(_pid) {
        PoolInfo storage pool = poolInfo[_pid];

        updatePool(_pid);

        UserInfo storage user = userInfo[_pid][msg.sender];

        uint256 pending = user.amount.mul(pool.accRewardPerShare).div(1e32).sub(user.rewardDebt);

        pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);

        user.amount = user.amount.add(_amount);
        pool.currentSupply = pool.currentSupply.add(_amount);
        user.rewardDebt = user.amount.mul(pool.accRewardPerShare).div(1e32);

        if(pending > 0) {
            if (address(pool.rewardToken) == address(wmovr)) { // convert wmovr to wan 
                wmovr.withdraw(pending);
                msg.sender.transfer(pending);
            } else {
                pool.rewardToken.safeTransfer(msg.sender, pending);
            }
        }
        emit Deposit(msg.sender, _pid, _amount);
    }

    // Withdraw LP tokens from MasterChef.
    function withdraw(uint256 _pid, uint256 _amount) external onlyValidPool(_pid) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        updatePool(_pid);
        uint256 pending = user.amount.mul(pool.accRewardPerShare).div(1e32).sub(user.rewardDebt);

        if(_amount > 0) {
            user.amount = user.amount.sub(_amount);
            pool.currentSupply = pool.currentSupply.sub(_amount);
        }
        user.rewardDebt = user.amount.mul(pool.accRewardPerShare).div(1e32);

        if (_amount > 0) {
            pool.lpToken.safeTransfer(msg.sender, _amount);
        }
        if(pending > 0) {
            if (address(pool.rewardToken) == address(wmovr)) { // convert wmovr to movr 
                wmovr.withdraw(pending);
                msg.sender.transfer(pending);
            } else {
                pool.rewardToken.safeTransfer(msg.sender, pending);
            }
        }
        emit Withdraw(msg.sender, _pid, _amount);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) external onlyValidPool(_pid) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        if(amount > 0){
            pool.currentSupply = pool.currentSupply.sub(user.amount);
            user.amount = 0;
            user.rewardDebt = 0;
            pool.lpToken.safeTransfer(msg.sender, amount);
        }
        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }

    receive() external payable {
        require(msg.sender == address(wmovr), "Only support value from WMOVR"); // only accept MOVR via fallback from the WMOVR contract
    }

    /* Internal and Private Function */
    // Return reward multiplier over the given _from to _to block.
    function getMultiplier(uint256 _from, uint256 _to, uint256 _startTime, uint256 _endTime) internal pure returns (uint256) {
        if (_from >= _endTime) {
            return 0;
        }

        if (_to < _startTime) {
            return 0;
        }

        if (_from < _startTime) {
            _from = _startTime;
        }

        if (_to > _endTime) {
            _to = _endTime;
        }
        return _to.sub(_from);
    }

    /* Get Function*/
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // View function to see pending reward on frontend.
    function pendingReward(uint256 _pid, address _user) external view onlyValidPool(_pid) returns (uint256, uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accRewardPerShare = pool.accRewardPerShare;

        if (block.timestamp > pool.lastRewardTimestamp && pool.currentSupply != 0) {
            uint256 multiplier = getMultiplier(pool.lastRewardTimestamp, block.timestamp, pool.bonusStartTimestamp, pool.bonusEndTimestamp);
            uint256 tokenReward = multiplier.mul(pool.rewardPerSecond);
            accRewardPerShare = accRewardPerShare.add(tokenReward.mul(1e32).div(pool.currentSupply));
        }
        return (user.amount, user.amount.mul(accRewardPerShare).div(1e32).sub(user.rewardDebt));
    }


}
