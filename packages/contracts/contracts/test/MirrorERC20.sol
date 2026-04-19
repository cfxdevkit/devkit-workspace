// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MirrorERC20
 * @notice ERC-20 token with mint() used for DEX simulation.
 *         Mirrors a real-world token (identified by mirrorOf address stored off-chain
 *         in the TranslationTable). Identical to TestERC20 — kept as a separate contract
 *         so artifact names are distinct.
 *
 * @dev Deployer-only mint gate prevents accidental use in production forks.
 *      decimals_ param is mandatory — never assume 18.
 */
contract MirrorERC20 is ERC20 {
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
        require(msg.sender == deployer, "MirrorERC20: only deployer");
        _mint(to, amount);
    }
}
