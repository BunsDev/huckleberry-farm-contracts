const { expectRevert } = require('@openzeppelin/test-helpers');
const FINN = artifacts.require('FINN');

contract('FINN', ([alice, bob, carol]) => {
    const initialSupply = '100000000000000000000000000'; 
    beforeEach(async () => {
        this.finn = await FINN.new(initialSupply, { from: alice });
    });

    it('should have correct name and symbol and decimal', async () => {
        const name = await this.finn.name();
        const symbol = await this.finn.symbol();
        const decimals = await this.finn.decimals();
        assert.equal(name.valueOf(), 'FINN Token');
        assert.equal(symbol.valueOf(), 'FINN');
        assert.equal(decimals.valueOf(), '18');

    });

    it('should only allow owner to mint token', async () => {
        await this.finn.mint(alice, '100', { from: alice });
        await this.finn.mint(bob, '1000', { from: alice });
        await expectRevert(
            this.finn.mint(carol, '1000', { from: bob }),
            'Ownable: caller is not the owner',
        );
        const totalSupply = await this.finn.totalSupply();
        const aliceBal = await this.finn.balanceOf(alice);
        const bobBal = await this.finn.balanceOf(bob);
        const carolBal = await this.finn.balanceOf(carol);
        assert.equal(totalSupply.valueOf(), '1100');
        assert.equal(aliceBal.valueOf(), '100');
        assert.equal(bobBal.valueOf(), '1000');
        assert.equal(carolBal.valueOf(), '0');
    });

    it('should supply token transfers properly', async () => {
        await this.finn.mint(alice, '100', { from: alice });
        await this.finn.mint(bob, '1000', { from: alice });
        await this.finn.transfer(carol, '10', { from: alice });
        await this.finn.transfer(carol, '100', { from: bob });
        const totalSupply = await this.finn.totalSupply();
        const aliceBal = await this.finn.balanceOf(alice);
        const bobBal = await this.finn.balanceOf(bob);
        const carolBal = await this.finn.balanceOf(carol);
        assert.equal(totalSupply.valueOf(), '1100');
        assert.equal(aliceBal.valueOf(), '90');
        assert.equal(bobBal.valueOf(), '900');
        assert.equal(carolBal.valueOf(), '110');
    });

    it('should fail if you try to do bad transfers', async () => {
        await this.finn.mint(alice, '100', { from: alice });
        await expectRevert(
            this.finn.transfer(carol, '110', { from: alice }),
            'ERC20: transfer amount exceeds balance',
        );
        await expectRevert(
            this.finn.transfer(carol, '1', { from: bob }),
            'ERC20: transfer amount exceeds balance',
        );
    });
  });
