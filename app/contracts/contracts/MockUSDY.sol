// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSDY
/// @notice Testnet mock implementing the IUSDY interface used by YieldAggregator.
///         1:1 share ratio for simplicity.
contract MockUSDY is ERC20, Ownable {
    constructor(address admin) ERC20("Mock USDY", "mUSDY") Ownable(admin) {
        // Mint initial supply for testing
        _mint(admin, 10_000_000 * 1e18);
    }

    /// @notice Simulate deposit: transfer `amount` from caller, mint `shares` (1:1)
    function deposit(address recipient, uint256 amount) external returns (uint256 shares) {
        _transfer(msg.sender, address(this), amount);
        shares = amount;
        _mint(recipient, shares);
        return shares;
    }

    /// @notice Simulate redeem: burn `shares`, transfer underlying back 1:1
    function redeem(uint256 shares, address recipient) external returns (uint256 amount) {
        _burn(msg.sender, shares);
        amount = shares;
        _transfer(address(this), recipient, amount);
        return amount;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
