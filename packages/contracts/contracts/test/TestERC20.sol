// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestERC20
 * @notice Generic mintable ERC-20 for unit tests.
 *         Use MirrorERC20 for simulation tokens (they carry mirrorOf metadata off-chain).
 */
contract TestERC20 is ERC20 {
    uint8   private  _dec;
    address public   deployer;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8         decimals_
    ) ERC20(name_, symbol_) {
        _dec     = decimals_;
        deployer = msg.sender;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == deployer, "TestERC20: only deployer");
        _mint(to, amount);
    }
}
