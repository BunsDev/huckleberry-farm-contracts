// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/proxy/TransparentUpgradeableProxy.sol";

// HuckleberryProxy is only used for 1 upgradeable contract:
// TokenRewardDelegate
contract HuckleberryProxy is TransparentUpgradeableProxy {
    constructor(address _logic, address admin_, bytes memory _data) 
        public 
        payable 
        TransparentUpgradeableProxy(_logic, admin_, _data) { }
}
