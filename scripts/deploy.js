const hre = require("hardhat");

async function main() {
  const FooToken = await hre.ethers.getContractFactory("FooToken");
  const token = await FooToken.deploy();

  await token.deployed();

  console.log("FooToken deployed to:", token.address);

  const RockPaperScissors = await hre.ethers.getContractFactory("RockPaperScissors");
  const instance = await RockPaperScissors.deploy(token.address);

  console.log("RockPaperScissors deployed to:", instance.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
