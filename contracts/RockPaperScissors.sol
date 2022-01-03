//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RockPaperScissors {
  enum Play { ROCK, PAPER, SCISSORS }

  struct Game {
    address maker;
    bool finished;
    bool settled;
    address taker;
    Play takerPlay;
    uint256 wager;
    uint256 timestamp;
    bytes32 makerPlay;
  }

  uint256 constant TIMEOUT = 1 hours;
  uint256 constant PLAYS_LENGTH = 3;

  address public immutable token;

  mapping(uint256 => Game) public games;
  mapping(address => uint256) public balances;

  uint256 public nextGameId;

  event GameCreated(uint256 indexed id, address indexed maker, uint256 wager);
  event GameFinished(uint256 indexed id, address indexed taker);
  event GameSettled(uint256 indexed id, address indexed winner);
  event GameClaimed(uint256 indexed id);
  event GameCanceled(uint256 indexed id);

  modifier existingGame(uint256 _gameId) {
    require(_gameId < nextGameId, "non existing game");
    _;
  }

  constructor(address _token) {
    token = _token;
    nextGameId = 0;
  }

  // maker sends play hashed as keccak256(value) being value a random number
  // so that value % 3 == desired play
  function createGame(bytes32 _play, uint256 _wager) external {
    require(_play != 0, "empty play");

    uint256 gameId = nextGameId;
    nextGameId += 1;

    games[gameId] = Game({
      maker: msg.sender,
      taker: address(0),
      wager: _wager,
      timestamp: block.timestamp,
      makerPlay: _play,
      takerPlay: Play(0),
      finished: false,
      settled: false
    });

    _transferWager(_wager);

    emit GameCreated(gameId, msg.sender, _wager);
  }

  function joinGame(uint256 _gameId, Play _play) external existingGame(_gameId) {
    Game storage game = games[_gameId];

    require(msg.sender != game.maker, "same as game maker");
    require(!game.finished, "game already finshed");

    game.finished = true;
    game.taker = msg.sender;
    game.takerPlay = _play;

    _transferWager(game.wager);

    emit GameFinished(_gameId, msg.sender);
  }

  // Maker can cancel game if it isnt finished
  function cancelGame(uint256 _gameId) external existingGame(_gameId) {
    Game storage game = games[_gameId];

    require(msg.sender == game.maker, "must be game maker");
    require(!game.finished, "game already finshed");

    game.finished = true;
    game.settled = true;

    balances[game.maker] += game.wager;

    emit GameCanceled(_gameId);
  }

  // Maker can settle game by revealing his play
  function settleGame(uint256 _gameId, uint256 _play) external existingGame(_gameId) {
    Game storage game = games[_gameId];

    require(msg.sender == game.maker, "must be game maker");
    require(game.finished, "game not finshed");
    require(!game.settled, "game already settled");

    require(keccak256(abi.encode(_play)) == game.makerPlay, "hashed value doesnt match play");

    game.settled = true;

    Play makerPlay = Play(_play % PLAYS_LENGTH);
    Play takerPlay = game.takerPlay;
    address winner = address(0);

    if (makerPlay == takerPlay) {
      balances[game.maker] += game.wager;
      balances[game.taker] += game.wager;
    } else if (
      (makerPlay == Play.ROCK && takerPlay == Play.SCISSORS) ||
      (makerPlay == Play.PAPER && takerPlay == Play.ROCK) ||
      (makerPlay == Play.SCISSORS && takerPlay == Play.PAPER)
    ) {
      winner = game.maker;
      balances[winner] += 2 * game.wager;
    } else {
      winner = game.taker;
      balances[winner] += 2 * game.wager;
    }

    emit GameSettled(_gameId, winner);
  }

  // Taker can claim game if expired, maker isn't incentivized to settle
  // a game is he loses
  function claimGame(uint256 _gameId) external existingGame(_gameId) {
    Game storage game = games[_gameId];

    require(msg.sender == game.taker, "must be game taker");
    require(!game.settled, "game already settled");
    require(block.timestamp >= game.timestamp + TIMEOUT, "game not expired");

    game.settled = true;

    balances[msg.sender] += 2 * game.wager;

    emit GameClaimed(_gameId);
  }

  function withdraw() external {
    require(balances[msg.sender] > 0, "balance is 0");

    uint256 amount = balances[msg.sender];
    balances[msg.sender] = 0;

    bool transferred = IERC20(token).transfer(msg.sender, amount);
    require(transferred, "error transferring tokens");
  }

  function _transferWager(uint256 _wager) private {
    if (_wager > 0) {
      uint256 balance = balances[msg.sender];

      if (balance >= _wager) {
        balances[msg.sender] -= _wager;
      } else {
        uint256 left = _wager - balance;
        balances[msg.sender] = 0;

        bool transferred = IERC20(token).transferFrom(msg.sender, address(this), left);
        require(transferred, "error transferring tokens");
      }
    }
  }
}
