// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ExampleCounter {
    uint256 public value;

    struct LockInfo {
        uint256 amount;
        uint64 unlockTimestamp;
    }

    mapping(address => LockInfo) private locks;

    event ValueChanged(uint256 value);
    event FundsLocked(address indexed account, uint256 amount, uint64 unlockTimestamp);
    event FundsWithdrawn(address indexed account, uint256 amount);

    function increment() external {
        value += 1;
        emit ValueChanged(value);
    }

    function reset() external {
        value = 0;
        emit ValueChanged(value);
    }

    function lock(uint64 unlockTimestamp) external payable {
        require(msg.value > 0, "value required");
        require(unlockTimestamp > block.timestamp, "unlock must be in future");

        LockInfo storage current = locks[msg.sender];
        if (current.amount > 0 && current.unlockTimestamp > block.timestamp) {
            require(unlockTimestamp >= current.unlockTimestamp, "cannot shorten active lock");
        }

        current.amount += msg.value;
        current.unlockTimestamp = unlockTimestamp;

        emit FundsLocked(msg.sender, current.amount, current.unlockTimestamp);
    }

    function getLock(address account) external view returns (uint256 amount, uint64 unlockTimestamp, bool claimable) {
        LockInfo storage current = locks[account];
        amount = current.amount;
        unlockTimestamp = current.unlockTimestamp;
        claimable = amount > 0 && block.timestamp >= unlockTimestamp;
    }

    function withdrawLocked() external {
        LockInfo storage current = locks[msg.sender];
        uint256 amount = current.amount;

        require(amount > 0, "nothing locked");
        require(block.timestamp >= current.unlockTimestamp, "lock still active");

        current.amount = 0;
        current.unlockTimestamp = 0;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");

        emit FundsWithdrawn(msg.sender, amount);
    }
}

