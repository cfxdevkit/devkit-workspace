// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ExampleCounter {
    uint256 private value;

    function increment() external {
        value += 1;
    }

    function current() external view returns (uint256) {
        return value;
    }
}
