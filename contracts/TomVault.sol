// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

interface ITOM is IERC20 {
    function deposit(uint256 _amount) external;
    function withdraw(uint256 _share) external;
    function finn() external view returns (address);
}

interface IFarm {
    function deposit(uint256 _pid, uint256 _amount) external;

    function withdraw(uint256 _pid, uint256 _amount) external;

    function pendingReward(uint256 _pid, address _user) external view returns (uint256);

    function userInfo(uint256 _pid, address _user) external view returns (uint256, uint256);

    function emergencyWithdraw(uint256 _pid) external;
}

contract TomVault is ERC20("mTOM Token", "mTOM"), Pausable, AccessControl {
    using SafeERC20 for IERC20;
    using SafeERC20 for ITOM;
    using SafeMath for uint256;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR");

    uint256 public immutable poolID;
    ITOM public immutable tom; // Tom token
    IFarm public immutable farm;

    address public treasury;

    uint256 public constant MAX_PERFORMANCE_FEE = 500; // 5%
    uint256 public constant MAX_CALL_FEE = 100; // 1%
    uint256 public constant DENOMINATOR = 10000;

    uint256 public performanceFee;
    uint256 public callFee = 25; // 0.25%

    event Deposit(address indexed sender, uint256 amount, uint256 shares, uint256 lastDepositedTime);
    event Withdraw(address indexed sender, uint256 amount, uint256 shares);
    event Harvest(address indexed sender, uint256 amount, uint256 performanceFee, uint256 callFee);
    event Pause();
    event Unpause();

    /**
     * @notice Constructor
     * @param _poolID: pool ID
     * @param _token: Tom token contract
     * @param _farm: HuckleberryFarm contract
     * @param _admin: address of the admin
     * @param _operator: address of the operator
     * @param _treasury: address of the treasury (collects fees)
     */
    constructor(
        uint256 _poolID,
        ITOM _token,
        IFarm _farm,
        address _admin,
        address _operator,
        address _treasury
    ) public {
        poolID = _poolID;
        tom = _token;
        farm = _farm;
        treasury = _treasury;

        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
        _setupRole(OPERATOR_ROLE, _operator);

        // Infinite approve
        _token.safeApprove(address(_farm), uint256(-1));
    }

    /**
     * @notice Checks if the msg.sender is the operator address
     */
    modifier onlyOperator() {
        require(hasRole(OPERATOR_ROLE, msg.sender), "not operator");
        _;
    }
    modifier onlyAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "not admin");
        _;
    }
    /**
     * @notice Checks if the msg.sender is a contract or a proxy
     */
    modifier notContract() {
        require(!Address.isContract(msg.sender), "contract not allowed");
        require(msg.sender == tx.origin, "proxy contract not allowed");
        _;
    }

    /**
     * @dev A helper function to call deposit() with all the sender's funds.
     */
    function depositAll() external {
        deposit(tom.balanceOf(msg.sender));
    }

    /**
     * @notice Deposits funds into the Tom Vault
     * @dev Only possible when contract not paused.
     * @param _amount: number of tokens to deposit (in TOM)
     */
    function deposit(uint256 _amount) public whenNotPaused notContract {
        require(_amount > 0, "nothing to deposit");

        uint256 _before = tom.balanceOf(address(this));
        tom.safeTransferFrom(msg.sender, address(this), _amount);
        uint256 _after = tom.balanceOf(address(this));
        _amount = _after.sub(_before); // Additional check for deflationary tokens

        uint256 currentShares;
        if (totalSupply() != 0) {
            _withdraw(0);
            currentShares = (_amount.mul(totalSupply())).div(balanceOf().sub(_amount));
        } else {
            currentShares = _amount;
        }
        _mint(msg.sender, currentShares);

        _earn();

        emit Deposit(msg.sender, _amount, currentShares, block.timestamp);
    }

    /**
     * @notice Withdraws all funds for a user
     */
    function withdrawAll() external {
        withdraw(balanceOf(msg.sender));
    }

    /**
     * @notice Withdraws from funds from the Tom Vault
     * @param _shares: Number of shares to withdraw
     */
    function withdraw(uint256 _shares) public notContract {
        uint256 currentAmount = (balanceOf().mul(_shares)).div(totalSupply());
        _burn(msg.sender, _shares);

        uint256 bal = available();
        bool needWithdrawAndEarn = bal < currentAmount;
        if (needWithdrawAndEarn) {
            _withdraw(currentAmount.sub(bal));
        }

        tom.safeTransfer(msg.sender, currentAmount);

        if (needWithdrawAndEarn) {
            _earn();
        }

        emit Withdraw(msg.sender, currentAmount, _shares);
    }

    /**
     * @notice Reinvests TOM tokens into HuckleberryFarm
     * @dev Only possible when contract not paused.
     */
    function harvest() external whenNotPaused returns (uint256 callerReward, uint256 performanceReward, uint256 totalPending) {
        _withdraw(0);

        totalPending = available();

        performanceReward = totalPending.mul(performanceFee).div(DENOMINATOR);
        if (performanceReward > 0) {
            tom.safeTransfer(treasury, performanceReward);
        }

        callerReward = totalPending.mul(callFee).div(DENOMINATOR);
        tom.safeTransfer(msg.sender, callerReward);

        _earn();

        emit Harvest(msg.sender, totalPending, performanceReward, callerReward);
    }

    /**
     * @notice Sets treasury address
     * @dev Only callable by the contract admin.
     */
    function setTreasury(address _treasury) external onlyAdmin {
        require(_treasury != address(0), "cannot be zero address");
        treasury = _treasury;
    }

    /**
     * @notice Sets performance fee
     * @dev Only callable by the contract operator.
     */
    function setPerformanceFee(uint256 _performanceFee) external onlyOperator {
        require(_performanceFee <= MAX_PERFORMANCE_FEE, "performanceFee cannot be more than MAX_PERFORMANCE_FEE");
        performanceFee = _performanceFee;
    }

    /**
     * @notice Sets call fee
     * @dev Only callable by the contract operator.
     */
    function setCallFee(uint256 _callFee) external onlyOperator {
        require(_callFee <= MAX_CALL_FEE, "callFee cannot be more than MAX_CALL_FEE");
        callFee = _callFee;
    }

    /**
     * @notice Withdraws from HuckleberryFarm to Vault without caring about rewards.
     * @dev EMERGENCY ONLY. Only callable by the contract operator.
     */
    function emergencyWithdraw() external onlyOperator {
        farm.emergencyWithdraw(poolID);
    }

    /**
     * @notice Withdraw unexpected tokens sent to the Tom Vault
     */
    function inCaseTokensGetStuck(address _token) external onlyAdmin {
        require(_token != address(tom), "token cannot be same as deposit token");
        require(_token != address(finn()), "token cannot be same as internal token of deposit token");

        uint256 amount = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Triggers stopped state
     * @dev Only possible when contract not paused.
     */
    function pause() public onlyOperator whenNotPaused {
        _pause();
        emit Pause();
    }

    /**
     * @notice Returns to normal state
     * @dev Only possible when contract is paused.
     */
    function unpause() external onlyOperator whenPaused {
        _unpause();
        emit Unpause();
    }

    /**
     * @notice Calculates the price per share
     */
    function getPricePerFullShare() external view returns (uint256) {
        return totalSupply() == 0 ? 1e18 : balanceOf().mul(1e18).div(totalSupply());
    }

    /**
     * @notice Custom logic for how much the vault allows to be borrowed
     * @dev The contract puts 100% of the tokens to work.
     */
    function available() public view returns (uint256) {
        return tom.balanceOf(address(this));
    }

    /**
     * @notice Calculates the total underlying tokens
     * @dev It includes tokens held by the contract and held in HuckleberryFarm
     */
    function balanceOf() public view returns (uint256) {
        (uint256 amount, ) = farm.userInfo(poolID, address(this));
        return tom.balanceOf(address(this)).add(amount);
    }

    function finn() public view returns (IERC20) {
        return IERC20(tom.finn());
    }

    function availableFinn() public view returns (uint256) {
        return finn().balanceOf(address(this));
    }

    function _finnToTom(uint256 _amount) internal {
        if (_amount > 0) {
            IERC20 finnToken = finn();
            ITOM tomToken = tom;
            if (finnToken.allowance(address(this), address(tomToken)) < _amount) {
                finnToken.safeApprove(address(tomToken), uint256(-1));
            }
            tomToken.deposit(_amount);
        }
    }

    function _withdraw(uint256 _amount) internal {
        farm.withdraw(poolID, _amount);
        _finnToTom(availableFinn());
    }

    /**
     * @notice Deposits tokens into HuckleberryFarm to earn staking rewards
     */
    function _earn() internal {
        uint256 bal = available();
        if (bal > 0) {
            farm.deposit(poolID, bal);
        }
    }
}