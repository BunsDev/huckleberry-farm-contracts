// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

// FinnBar is the coolest bar in town. You deposit some FINN, and withdraw with more! The longer you stay, the more FINN you get.
//
// This contract handles swapping to and from TOM, HuckleberrySwap's staking token.
contract FinnBar is ERC20("TOM Token", "TOM") {
    using SafeMath for uint256;
    IERC20 public finn;

    event Deposit(address indexed user, uint256 inputAmount, uint256 lockedAmount, uint256 mintedAmount);
    event Withdraw(address indexed user, uint256 releasedAmount, uint256 burnedAmount);

    // Define the FINN token contract
    constructor(IERC20 _finn) public {
        finn = _finn;
    }

    // deposit to the bar. Pay some FINNs. Earn some shares.
    // Locks FINN and mints TOM
    function deposit(uint256 _amount) public {
        // Gets the amount of FINN locked in the contract
        uint256 totalFinn = finn.balanceOf(address(this));
        // Gets the amount of TOM in existence
        uint256 totalShares = totalSupply();

        // Lock the FINN in the contract
        finn.transferFrom(msg.sender, address(this), _amount);
        uint256 finalDepositAmount = finn.balanceOf(address(this)).sub(totalFinn);

        // If no TOM exists, mint it 1:1 to the amount put in
        if (totalShares == 0 || totalFinn == 0) {
            _mint(msg.sender, finalDepositAmount);
            emit Deposit(msg.sender, _amount, finalDepositAmount, finalDepositAmount);
        }
        // Calculate and mint the amount of TOM the FINN is worth. The ratio will change overtime, as TOM is burned/minted and FINN deposited + gained from fees / withdrawn.
        else {
            uint256 what = finalDepositAmount.mul(totalShares).div(totalFinn);
            _mint(msg.sender, what);
            emit Deposit(msg.sender, _amount, finalDepositAmount, what);
        }
    }

    // Withdraw the bar. Claim back your FINNs.
    // Unlocks the staked + gained FINN and burns TOM
    function withdraw(uint256 _share) public {
        // Gets the amount of TOM in existence
        uint256 totalShares = totalSupply();
        // Calculates the amount of FINN the TOM is worth
        uint256 what = _share.mul(finn.balanceOf(address(this))).div(totalShares);
        _burn(msg.sender, _share);
        finn.transfer(msg.sender, what);

        emit Withdraw(msg.sender, what, _share);
    }
}
