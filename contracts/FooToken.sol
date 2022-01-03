//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FooToken is ERC20 {
  constructor() ERC20("Foo", "FOO") {
  }

  // lfg
  function mint(uint256 amount) public {
    _mint(msg.sender, amount);
  }
}
