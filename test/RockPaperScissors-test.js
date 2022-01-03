const { expect } = require('chai');
const { ethers } = require('hardhat');

const Play = {
  ROCK: 0,
  PAPER: 1,
  SCISSORS: 2,
};

function hashPlay(play) {
  return ethers.utils.solidityKeccak256(['uint256'], [play]);
}

describe('RockPaperScissors', function () {
  let alice, bob;
  let token;
  let instance;

  beforeEach(async () => {
    [, alice, bob, eve] = await ethers.getSigners();

    const FooToken = await ethers.getContractFactory('FooToken');
    token = await FooToken.deploy();
    await token.deployed();

    const RockPaperScissors = await ethers.getContractFactory('RockPaperScissors');
    instance = await RockPaperScissors.deploy(token.address);
    await instance.deployed();

    const aliceMintTx = await token.connect(alice).mint(999);
    await aliceMintTx.wait();
    const aliceApproveTx = await token.connect(alice).approve(instance.address, 10);
    await aliceApproveTx.wait();

    const bobMintTx = await token.connect(bob).mint(999);
    await bobMintTx.wait();
    const bobApproveTx = await token.connect(bob).approve(instance.address, 10);
    await bobApproveTx.wait();

    const eveMintTx = await token.connect(eve).mint(999);
    await eveMintTx.wait();
    const eveApproveTx = await token.connect(eve).approve(instance.address, 10);
    await eveApproveTx.wait();
  });

  describe('createGame', () => {
    it('creates a new game', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      const game = await instance.games(gameId);
      const block = await ethers.provider.getBlock(createTx.blockNumber);

      expect(game.maker).to.equal(alice.address);
      expect(game.taker).to.equal(ethers.constants.AddressZero);
      expect(game.wager).to.equal(wager);
      expect(game.timestamp).to.equal(block.timestamp);
      expect(game.makerPlay).to.equal(makerPlay);
      expect(game.takerPlay).to.equal(0);
      expect(game.finished).to.equal(false);
      expect(game.settled).to.equal(false);
    });

    it('emits a new game event', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      await expect(instance.connect(alice).createGame(makerPlay, wager))
        .to.emit(instance, 'GameCreated')
        .withArgs(gameId, alice.address, wager);
    });

    it('increases next game id when creating a game', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      expect(await instance.nextGameId()).to.equal(gameId + 1);
    });

    it('transfers tokens to contract', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);

      await expect(() => instance.connect(alice).createGame(makerPlay, wager))
        .to.changeTokenBalances(token, [alice, instance], [-wager, wager]);
    });

    it('allows to create a new game with an empty wager', async() => {
      const wager = 0;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      await expect(() => instance.connect(alice).createGame(makerPlay, wager))
        .to.changeTokenBalances(token, [alice, instance], [0, 0]);

      const game = await instance.games(gameId);

      expect(game.wager).to.equal(0);
    });

    it('throws with empty play', async () => {
      const wager = 1;
      const makerPlay = ethers.utils.formatBytes32String('');

      await expect(instance.connect(alice).createGame(makerPlay, wager))
        .to.be.revertedWith('empty play');
    });

    it('uses user balance to pay wager (exact amount)', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const prevGameId = await instance.nextGameId();

      const prevCreateTx = await instance.connect(alice).createGame(makerPlay, wager);
      await prevCreateTx.wait();

      const prevCancelTx = await instance.connect(alice).cancelGame(prevGameId);
      await prevCancelTx.wait();

      expect(await instance.balances(alice.address)).to.equal(wager);

      await expect(() => instance.connect(alice).createGame(makerPlay, wager))
        .to.changeTokenBalances(token, [alice, instance], [0, 0]);

      expect(await instance.balances(alice.address)).to.equal(0);
    });

    it('uses user balance to pay wager (less amount)', async () => {
      const prevWager = 2;
      const makerPlay = hashPlay(7);
      const prevGameId = await instance.nextGameId();

      const prevCreateTx = await instance.connect(alice).createGame(makerPlay, prevWager);
      await prevCreateTx.wait();

      const prevCancelTx = await instance.connect(alice).cancelGame(prevGameId);
      await prevCancelTx.wait();

      expect(await instance.balances(alice.address)).to.equal(prevWager);

      const wager = 1;

      await expect(() => instance.connect(alice).createGame(makerPlay, wager))
        .to.changeTokenBalances(token, [alice, instance], [0, 0]);

      expect(await instance.balances(alice.address)).to.equal(prevWager - wager);
    });

    it('uses user balance to pay wager (more amount)', async () => {
      const prevWager = 1;
      const makerPlay = hashPlay(7);
      const prevGameId = await instance.nextGameId();

      const prevCreateTx = await instance.connect(alice).createGame(makerPlay, prevWager);
      await prevCreateTx.wait();

      const prevCancelTx = await instance.connect(alice).cancelGame(prevGameId);
      await prevCancelTx.wait();

      expect(await instance.balances(alice.address)).to.equal(prevWager);

      const wager = 2;
      const difference = wager - prevWager;

      await expect(() => instance.connect(alice).createGame(makerPlay, wager))
        .to.changeTokenBalances(token, [alice, instance], [-difference, difference]);

      expect(await instance.balances(alice.address)).to.equal(0);
    });
  });

  describe('joinGame', () => {
    it('throws if game doesnt exist', async () => {
      const takerPlay = 1;
      const gameId = 404;

      await expect(instance.connect(bob).joinGame(gameId, takerPlay))
        .to.be.revertedWith('non existing game');
    });

    it('joins an existing game', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const takerPlay = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      const game = await instance.games(gameId);

      expect(game.taker).to.equal(bob.address);
      expect(game.takerPlay).to.equal(takerPlay);
      expect(game.finished).to.equal(true);
      expect(game.settled).to.equal(false);
    });

    it('emits a join game event', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const takerPlay = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      await expect(instance.connect(bob).joinGame(gameId, takerPlay))
        .to.emit(instance, 'GameFinished')
        .withArgs(gameId, bob.address);
    });

    it('throws if user is same as maker', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const takerPlay = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      await expect(instance.connect(alice).joinGame(gameId, takerPlay))
        .to.be.revertedWith('same as game maker');
    });

    it('throws if game is already finished', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const takerPlay = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      const otherJoinTx = await instance.connect(eve).joinGame(gameId, takerPlay);
      await otherJoinTx.wait();

      await expect(instance.connect(bob).joinGame(gameId, takerPlay))
        .to.be.revertedWith('game already finshed');
    });

    it('transfers tokens to contract', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const takerPlay = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      await expect(() => instance.connect(bob).joinGame(gameId, takerPlay))
        .to.changeTokenBalances(token, [bob, instance], [-wager, wager]);
    });

    it('joins a game with an empty wager', async() => {
      const wager = 0;
      const makerPlay = hashPlay(7);
      const takerPlay = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      await expect(() => instance.connect(bob).joinGame(gameId, takerPlay))
        .to.changeTokenBalances(token, [bob, instance], [0, 0]);
    });

    it('uses user balance to pay wager (exact amount)', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const takerPlay = 1;
      const prevGameId = await instance.nextGameId();

      const prevCreateTx = await instance.connect(bob).createGame(makerPlay, wager);
      await prevCreateTx.wait();

      const prevCancelTx = await instance.connect(bob).cancelGame(prevGameId);
      await prevCancelTx.wait();

      expect(await instance.balances(bob.address)).to.equal(wager);

      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      await expect(() => instance.connect(bob).joinGame(gameId, takerPlay))
        .to.changeTokenBalances(token, [bob, instance], [0, 0]);

      expect(await instance.balances(bob.address)).to.equal(0);
    });

    it('uses user balance to pay wager (less amount)', async () => {
      const prevWager = 2;
      const makerPlay = hashPlay(7);
      const takerPlay = 1;
      const prevGameId = await instance.nextGameId();

      const prevCreateTx = await instance.connect(bob).createGame(makerPlay, prevWager);
      await prevCreateTx.wait();

      const prevCancelTx = await instance.connect(bob).cancelGame(prevGameId);
      await prevCancelTx.wait();

      expect(await instance.balances(bob.address)).to.equal(prevWager);

      const wager = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      await expect(() => instance.connect(bob).joinGame(gameId, takerPlay))
        .to.changeTokenBalances(token, [bob, instance], [0, 0]);

      expect(await instance.balances(bob.address)).to.equal(prevWager - wager);
    });

    it('uses user balance to pay wager (more amount)', async () => {
      const prevWager = 1;
      const makerPlay = hashPlay(7);
      const takerPlay = 1;
      const prevGameId = await instance.nextGameId();

      const prevCreateTx = await instance.connect(bob).createGame(makerPlay, prevWager);
      await prevCreateTx.wait();

      const prevCancelTx = await instance.connect(bob).cancelGame(prevGameId);
      await prevCancelTx.wait();

      expect(await instance.balances(bob.address)).to.equal(prevWager);

      const wager = 2;
      const difference = wager - prevWager;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      await expect(() => instance.connect(bob).joinGame(gameId, takerPlay))
        .to.changeTokenBalances(token, [bob, instance], [-difference, difference]);

      expect(await instance.balances(bob.address)).to.equal(0);
    });
  });

  describe('cancelGame', () => {
    it('throws if game doesnt exist', async () => {
      const gameId = 404;

      await expect(instance.connect(alice).cancelGame(gameId))
        .to.be.revertedWith('non existing game');
    });

    it('cancels a non finished game', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      const cancelTx = await instance.connect(alice).cancelGame(gameId);
      await cancelTx.wait();

      const game = await instance.games(gameId);

      expect(game.finished).to.equal(true);
      expect(game.settled).to.equal(true);
    });

    it('cancels and adds wager balance to user', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      const currentBalance = await instance.balances(alice.address);

      const cancelTx = await instance.connect(alice).cancelGame(gameId);
      await cancelTx.wait();

      expect(await instance.balances(alice.address)).to.equal(currentBalance + wager);
    });

    it('emits a canceled game event', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      await expect(instance.connect(alice).cancelGame(gameId))
        .to.emit(instance, 'GameCanceled')
        .withArgs(gameId);
    });

    it('throws if user is not maker', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      await expect(instance.connect(bob).cancelGame(gameId))
        .to.be.revertedWith('must be game maker');
    });

    it('throws if game is already finished', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const takerPlay = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      await expect(instance.connect(alice).cancelGame(gameId))
        .to.be.revertedWith('game already finshed');
    });

    it('throws if game is already canceled', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      const cancelTx = await instance.connect(alice).cancelGame(gameId);
      await cancelTx.wait();

      await expect(instance.connect(alice).cancelGame(gameId))
        .to.be.revertedWith('game already finshed');
    });
  });

  describe('settleGame', () => {
    it('throws if game doesnt exist', async () => {
      const gameId = 404;
      const makerPlay = 7;

      await expect(instance.connect(alice).settleGame(gameId, makerPlay))
        .to.be.revertedWith('non existing game');
    });

    it('throws if user is not maker', async () => {
      const wager = 1;
      const makerPlay = 7;
      const hashedMakerPlay = hashPlay(makerPlay);
      const takerPlay = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      await expect(instance.connect(bob).settleGame(gameId, makerPlay))
        .to.be.revertedWith('must be game maker');
    });

    it('throws if game is not finished', async () => {
      const wager = 1;
      const makerPlay = 7;
      const hashedMakerPlay = hashPlay(makerPlay);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      await expect(instance.connect(alice).settleGame(gameId, makerPlay))
        .to.be.revertedWith('game not finshed');
    });

    it('throws if play doesnt match hashed value', async () => {
      const wager = 1;
      const makerPlay = 8;
      const hashedMakerPlay = hashPlay(makerPlay - 1);
      const takerPlay = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      await expect(instance.connect(alice).settleGame(gameId, makerPlay))
        .to.be.revertedWith('hashed value doesnt match play');
    });

    it('settles a finished game', async () => {
      const wager = 1;
      const makerPlay = 7;
      const hashedMakerPlay = hashPlay(makerPlay);
      const takerPlay = 1;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      const settleTx = await instance.connect(alice).settleGame(gameId, makerPlay);
      await settleTx.wait();

      const game = await instance.games(gameId);

      expect(game.settled).to.equal(true);
    });

    describe('play scenarios', () => {
      async function expectWinner(makerPlay, takerPlay, winner) {
        const wager = 1;
        const paddedMakerPlay = 6 + makerPlay;
        const hashedMakerPlay = hashPlay(paddedMakerPlay);
        const gameId = await instance.nextGameId();

        const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
        await createTx.wait();

        const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
        await joinTx.wait();

        const makerBalance = await instance.balances(alice.address);
        const takerBalance = await instance.balances(bob.address);

        await expect(instance.connect(alice).settleGame(gameId, paddedMakerPlay))
          .to.emit(instance, 'GameSettled')
          .withArgs(gameId, winner);

        if (winner == ethers.constants.AddressZero) {
          expect(await instance.balances(alice.address)).to.equal(makerBalance + wager);
          expect(await instance.balances(bob.address)).to.equal(takerBalance + wager);
        } else {
          expect(await instance.balances(winner)).to.equal(makerBalance + 2 * wager);
        }
      }

      it('settles rock vs rock', async () => {
        await expectWinner(Play.ROCK, Play.ROCK, ethers.constants.AddressZero);
      });

      it('settles rock vs paper', async () => {
        await expectWinner(Play.ROCK, Play.PAPER, bob.address);
      });

      it('settles rock vs scissors', async () => {
        await expectWinner(Play.ROCK, Play.SCISSORS, alice.address);
      });

      it('settles paper vs rock', async () => {
        await expectWinner(Play.PAPER, Play.ROCK, alice.address);
      });

      it('settles paper vs paper', async () => {
        await expectWinner(Play.PAPER, Play.PAPER, ethers.constants.AddressZero);
      });

      it('settles paper vs scissors', async () => {
        await expectWinner(Play.PAPER, Play.SCISSORS, bob.address);
      });

      it('settles scissors vs rock', async () => {
        await expectWinner(Play.SCISSORS, Play.ROCK, bob.address);
      });

      it('settles scissors vs paper', async () => {
        await expectWinner(Play.SCISSORS, Play.PAPER, alice.address);
      });

      it('settles scissors vs scissors', async () => {
        await expectWinner(Play.SCISSORS, Play.SCISSORS, ethers.constants.AddressZero);
      });
    });

    it('throws if game is already settled', async () => {
      const wager = 1;
      const makerPlay = 6 + Play.ROCK;
      const hashedMakerPlay = hashPlay(makerPlay);
      const takerPlay = Play.ROCK;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      const settleTx = await instance.connect(alice).settleGame(gameId, makerPlay);
      await settleTx.wait();

      await expect(instance.connect(alice).settleGame(gameId, makerPlay))
        .to.be.revertedWith('game already settled');
    });

    it('throws if game has been canceled', async () => {
      const wager = 1;
      const makerPlay = 6 + Play.ROCK;
      const hashedMakerPlay = hashPlay(makerPlay);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const cancelTx = await instance.connect(alice).cancelGame(gameId);
      await cancelTx.wait();

      await expect(instance.connect(alice).settleGame(gameId, makerPlay))
        .to.be.revertedWith('game already settled');
    });
  });

  describe('claimGame', () => {
    const TIMEOUT = 60 * 60;

    it('throws if game doesnt exist', async () => {
      const gameId = 404;

      await expect(instance.connect(bob).claimGame(gameId))
        .to.be.revertedWith('non existing game');
    });

    it('claims game if expired', async () => {
      const wager = 1;
      const hashedMakerPlay = hashPlay(6 + Play.PAPER);
      const takerPlay = Play.ROCK;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      await ethers.provider.send('evm_increaseTime', [TIMEOUT]);

      const claimTx = await instance.connect(bob).claimGame(gameId);
      await claimTx.wait();

      const game = await instance.games(gameId);

      expect(game.settled).to.equal(true);
    });

    it('emits a settled game event', async () => {
      const wager = 1;
      const hashedMakerPlay = hashPlay(6 + Play.PAPER);
      const takerPlay = Play.ROCK;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      await ethers.provider.send('evm_increaseTime', [TIMEOUT]);

      await expect(instance.connect(bob).claimGame(gameId))
        .to.emit(instance, 'GameClaimed')
        .withArgs(gameId);
    });

    it('adds wager to taker', async () => {
      const wager = 1;
      const hashedMakerPlay = hashPlay(6 + Play.PAPER);
      const takerPlay = Play.ROCK;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      await ethers.provider.send('evm_increaseTime', [TIMEOUT]);

      const makerBalance = await instance.balances(alice.address);
      const takerBalance = await instance.balances(bob.address);

      const claimTx = await instance.connect(bob).claimGame(gameId);
      await claimTx.wait();

      expect(await instance.balances(alice.address)).to.equal(makerBalance);
      expect(await instance.balances(bob.address)).to.equal(takerBalance + 2 * wager);
    });

    it('throws if game is not expired', async () => {
      const wager = 1;
      const hashedMakerPlay = hashPlay(6 + Play.SCISSORS);
      const takerPlay = Play.ROCK;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      await expect(instance.connect(bob).claimGame(gameId))
        .to.be.revertedWith('game not expired');
    });

    it('throws if user is not taker', async () => {
      const wager = 1;
      const hashedMakerPlay = hashPlay(6 + Play.SCISSORS);
      const takerPlay = Play.ROCK;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      await ethers.provider.send('evm_increaseTime', [TIMEOUT]);

      await expect(instance.connect(alice).claimGame(gameId))
        .to.be.revertedWith('must be game taker');
    });

    it('throws if game is already claimed', async () => {
      const wager = 1;
      const hashedMakerPlay = hashPlay(6 + Play.PAPER);
      const takerPlay = Play.ROCK;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      await ethers.provider.send('evm_increaseTime', [TIMEOUT]);

      const claimTx = await instance.connect(bob).claimGame(gameId);
      await claimTx.wait();

      await expect(instance.connect(bob).claimGame(gameId))
        .to.be.revertedWith('game already settled');
    });

    it('throws if game is already settled', async () => {
      const wager = 1;
      const makerPlay = 6 + Play.PAPER
      const hashedMakerPlay = hashPlay(makerPlay);
      const takerPlay = Play.ROCK;
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(hashedMakerPlay, wager);
      await createTx.wait();

      const joinTx = await instance.connect(bob).joinGame(gameId, takerPlay);
      await joinTx.wait();

      const settleTx = await instance.connect(alice).settleGame(gameId, makerPlay);
      await settleTx.wait();

      await ethers.provider.send('evm_increaseTime', [TIMEOUT]);

      await expect(instance.connect(bob).claimGame(gameId))
        .to.be.revertedWith('game already settled');
    });
  });

  describe('withdraw', () => {
    it('throws if balance is 0', async () => {
      await expect(instance.connect(alice).withdraw())
        .to.be.revertedWith('balance is 0');
    });

    it('transfers tokens', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      const cancelTx = await instance.connect(alice).cancelGame(gameId);
      await cancelTx.wait();

      await expect(() => instance.connect(alice).withdraw())
        .to.changeTokenBalances(token, [alice, instance], [wager, -wager]);
    });

    it('sets balance to 0', async () => {
      const wager = 1;
      const makerPlay = hashPlay(7);
      const gameId = await instance.nextGameId();

      const createTx = await instance.connect(alice).createGame(makerPlay, wager);
      await createTx.wait();

      const cancelTx = await instance.connect(alice).cancelGame(gameId);
      await cancelTx.wait();

      expect(await instance.balances(alice.address)).to.equal(wager);

      const withdrawTx = await instance.connect(alice).withdraw();
      await withdrawTx.wait();

      expect(await instance.balances(alice.address)).to.equal(0);
    });
  });
});
