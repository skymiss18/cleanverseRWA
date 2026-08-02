// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ComplianceModule} from "./ComplianceModule.sol";

/// @title CleanversePoolAdapter
/// @notice Ownable compliance pool registered with Cleanverse CCP.
///         Local pause state is synchronized after Cleanverse pool mutations.
contract CleanversePoolAdapter is Ownable, Pausable {
    ComplianceModule public immutable complianceModule;

    event CompliancePoolPauseUpdated(bool paused);

    constructor(address owner_, ComplianceModule module_) Ownable(owner_) {
        complianceModule = module_;
    }

    function setPaused(bool paused_) external onlyOwner {
        if (paused_) {
            _pause();
        } else {
            _unpause();
        }
        emit CompliancePoolPauseUpdated(paused_);
    }

    function canMint(address investor, bytes32 assetId) external view returns (bool) {
        return !paused() && complianceModule.canMint(investor, assetId);
    }

    function canTransfer(address from, address to) external view returns (bool) {
        return !paused() && complianceModule.canTransfer(from, to);
    }
}