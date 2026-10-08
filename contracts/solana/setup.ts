// SBOR on Solana: one-time setup. Creates the account that holds SBOR's
// rates and names SBOR's Solana publisher, the only key allowed to post.
// Run once, after deploying, with the network set to mainnet-beta.
const PUBLISHER = new web3.PublicKey("AY5EE9QiCpxy7DhpyZ81VReoBg94vt7dgaqzbqmwJtD1");
const [state] = web3.PublicKey.findProgramAddressSync([Buffer.from("sbor-fixings")], pg.PROGRAM_ID);
const ix = new web3.TransactionInstruction({
  programId: pg.PROGRAM_ID,
  keys: [
    { pubkey: pg.wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: state, isSigner: false, isWritable: true },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([Buffer.from([0]), PUBLISHER.toBuffer()]),
});
const sig = await web3.sendAndConfirmTransaction(pg.connection, new web3.Transaction().add(ix), [pg.wallet.keypair]);
console.log("SBOR program:", pg.PROGRAM_ID.toBase58());
console.log("SBOR state account:", state.toBase58());
console.log("Setup transaction:", sig);
