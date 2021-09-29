// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

/*
 * HuckleberryFinance
 * App:             https://huckleberry.finance
 * GitHub:          https://github.com/huckleberryfinance
 */

import "./RERC20.sol";

contract FINN is RERC20 {
    // 1% fee to all holders
    constructor (uint256 initialSupply) public RERC20(initialSupply, "FINN Token", "FINN", 18, 100) {}

}

