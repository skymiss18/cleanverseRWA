// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockMETH
/// @notice Testnet mock implementing the ImETH interface used by YieldAggregator.
///         1:1 share ratio for simplicity. Accepts MNT (native) and issues shares.
contract MockMETH is ERC20, Ownable {
    constructor(address admin) ERC20("Mock mETH", "mmETH") Ownable(admin) {
        _mint(admin, 10_000 * 1e18);
    }

    /// @notice Simulate stake: accept native MNT, mint 1:1 shares
    function stake() external payable returns (uint256 shares) {
        shares = msg.value;
        _mint(msg.sender, shares);
        return shares;
    }

    /// @notice Simulate unstake: burn shares, send native MNT back 1:1
    function unstake(uint256 shares) external returns (uint256 amount) {
        _burn(msg.sender, shares);
        amount = shares;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");
        return amount;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    receive() external payable {}
}
