const { deployMockContract } = require('@ethereum-waffle/mock-contract');
const { ethers } = require('hardhat');
const { expect } = require('chai');
const ethCrypto = require('eth-crypto');

const IWIDO = require('../artifacts/contracts/interfaces/IWIDO.sol/IWIDO.json');

const signer1 = '0xe6Dba9e3f988902d5b407615c19e89D756396447';
const signer1Key = '0x34cee9ead792f332d133b1bfc7a915438e41bc42cec0ef3f4f79b74877a16012';
const signer2 = '0x6Fda6B0E6Adf2664D9b30199A54B77b050874656';
const signer2Key = '0x16f8c6cc563f28f8b213b85a0f7149243794e3b0f87519833b08f6838892121c';

const ethSign = msgHash => ethers.utils.solidityKeccak256(
  ['bytes'],
  [ethers.utils.solidityPack(
    ['string', 'bytes'],
    ['\x19Ethereum Signed Message:\n32', msgHash]
  )]
);

async function setup() {
  const [owner, bridgeWallet, alice, bob, carol] = await ethers.getSigners();
  const wido = await deployMockContract(owner, IWIDO.abi);
  const RelayManager2Secure = await ethers.getContractFactory('RelayManager2Secure');
  const relayer = await RelayManager2Secure.deploy(
    wido.address,
    ethers.utils.parseEther('5'),
    bridgeWallet.address,
    1,
    [signer1]
  );
  return {wido, relayer, owner, bridgeWallet, alice, bob, carol};
}

describe('RelayManager2Secure', async () => {
  let relayer, wido;
  let owner, bridgeWallet, alice, bob, carol;
  let msgHash, ethSignedMsgHash, sig1, sig2;

  describe('Setters', async () => {
    it('expect to add signer', async () => {
      ({wido, relayer, owner, bridgeWallet, alice, bob, carol} = await setup());
      msgHash = ethers.utils.solidityKeccak256(
        ['bytes'],
        [ethers.utils.solidityPack(
          ['address'],
          [signer2]
        )]
      );
      sig1 = ethCrypto.sign(signer1Key, ethSign(msgHash));
      await relayer.addSigner(signer2, [sig1]);
      expect(await relayer.signerLength()).to.eq(2);
    });
    it('expect to remove signer', async () => {
      msgHash = ethers.utils.solidityKeccak256(
        ['bytes'],
        [ethers.utils.solidityPack(
          ['address'],
          [signer2]
        )]
      );
      sig1 = ethCrypto.sign(signer1Key, ethSign(msgHash));
      await relayer.removeSigner(signer2, [sig1]);
      expect(await relayer.signerLength()).to.eq(1);
    });
    describe('reverts if', async () => {
      it('non-operator call setters', async () => {
        await expect(relayer.connect(alice).setAdminFee(0, [sig1]))
          .to.be.revertedWith('Operatorable: CALLER_NO_OPERATOR_ROLE');
        });
      it('zero bridgeWallet, zero threshold, zero adminFee', async () => {
        await expect(relayer.setAdminFee(0, [sig1]))
          .to.be.revertedWith('RelayManager2Secure: ADMIN_FEE_INVALID');
        await expect(relayer.setThreshold(0, [sig1]))
          .to.be.revertedWith('RelayManager2Secure: THRESHOLD_INVALID');
        await expect(relayer.setBridgeWallet(ethers.constants.AddressZero, [sig1]))
          .to.be.revertedWith('RelayManager2Secure: BRIDGE_WALLET_ADDRESS_INVALID');
      });
    });
  });

  describe('Transfer', async () => {
    it('expect to deposit', async () => {
      await wido.mock.burn.withArgs(alice.address, ethers.utils.parseEther('100')).returns();
      await expect(relayer.connect(alice).deposit(bob.address, ethers.utils.parseEther('100'), 56))
        .to.emit(relayer, 'Deposited');
    });
    it('expect to send', async () => {
      // add signer2 to test with 2 signers
      ({wido, relayer, owner, bridgeWallet, alice, bob, carol} = await setup());
      msgHash = ethers.utils.solidityKeccak256(
        ['bytes'],
        [ethers.utils.solidityPack(
          ['address'],
          [signer2]
        )]
      );
      sig1 = ethCrypto.sign(signer1Key, ethSign(msgHash));
      await relayer.addSigner(signer2, [sig1]);

      msgHash = ethers.utils.solidityKeccak256(
        ['bytes'],
        [ethers.utils.solidityPack(
          ['address', 'address', 'uint256', 'uint256'],
          [alice.address, bob.address, ethers.utils.parseEther('100'), 0]
        )]
      );
      await wido.mock.mint.withArgs(bob.address, ethers.utils.parseEther('95')).returns();
      await wido.mock.mint.withArgs(bridgeWallet.address, ethers.utils.parseEther('5')).returns();
      sig1 = ethCrypto.sign(signer1Key, ethSign(msgHash));
      sig2 = ethCrypto.sign(signer2Key, ethSign(msgHash));
      await relayer.send(alice.address, bob.address, ethers.utils.parseEther('100'), 0, [sig2, sig1]);
    });
    describe('reverts if', async () => {
      it('deposit amount is less than admin fee', async () => {
        await expect(relayer.connect(alice).deposit(bob.address, ethers.utils.parseEther('1'), 56))
          .to.be.revertedWith('RelayManager2Secure: DEPOSIT_AMOUNT_INVALID');
      });
      it('deposit receiver address is zero address', async () => {
        await expect(relayer.connect(alice).deposit(ethers.constants.AddressZero, ethers.utils.parseEther('100'), 56))
          .to.be.revertedWith('RelayManager2Secure: RECEIVER_ZERO_ADDRESS');
      });
      it('signatures are not in ascending order in send()', async () => {
        await expect(relayer.send(alice.address, bob.address, ethers.utils.parseEther('100'), 0, [sig1, sig2]))
          .to.be.revertedWith('RelayManager2Secure: INVALID_SIGNATURE');
      });
      it('signatures are reused in send()', async () => {
        await expect(relayer.send(alice.address, bob.address, ethers.utils.parseEther('100'), 0, [sig1, sig1]))
          .to.be.revertedWith('RelayManager2Secure: INVALID_SIGNATURE');
      });
      it('nonce is reused in send()', async () => {
        await expect(relayer.send(alice.address, bob.address, ethers.utils.parseEther('100'), 0, [sig2, sig1]))
          .to.be.revertedWith('RelayManager2Secure: TRANSFER_NONCE_ALREADY_PROCESSED');
      });
    });
  });
});
