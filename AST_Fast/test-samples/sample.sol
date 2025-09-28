// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SampleToken
 * @dev A simple ERC20 token for testing
 */
contract SampleToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1000000 * 10**18;
    mapping(address => bool) public whitelist;
    
    event Whitelisted(address indexed account);
    event RemovedFromWhitelist(address indexed account);
    
    modifier onlyWhitelisted() {
        require(whitelist[msg.sender], "Not whitelisted");
        _;
    }
    
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 100000 * 10**18);
    }
    
    function mint(address to, uint256 amount) public onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }
    
    function addToWhitelist(address account) external onlyOwner {
        whitelist[account] = true;
        emit Whitelisted(account);
    }
    
    function removeFromWhitelist(address account) external onlyOwner {
        whitelist[account] = false;
        emit RemovedFromWhitelist(account);
    }
    
    function transfer(address to, uint256 amount) public override onlyWhitelisted returns (bool) {
        return super.transfer(to, amount);
    }
}

interface IStaking {
    function stake(uint256 amount) external;
    function unstake(uint256 amount) external;
    function getRewards() external view returns (uint256);
}

library MathUtils {
    function percentage(uint256 value, uint256 percent) internal pure returns (uint256) {
        return (value * percent) / 100;
    }
}


