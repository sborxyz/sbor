//! SBOR fixings on Solana.
//!
//! Holds the latest daily SBOR rates, the same rows SBOR posts on Stacks, Arc
//! and Base: for each benchmark, the fixing's date, the borrow and supply rate
//! in basis points, the size in dollars, and when it was posted. One account,
//! at the address derived from the seed "sbor-fixings", holds everything.
//!
//! Only the publisher may post; only the owner may change the publisher or
//! hand over ownership. Anyone may read the account.
//!
//! Instructions, first byte:
//!   0 initialize      owner (signer, payer), state, system program
//!                     data: publisher (32)
//!   1 publish         publisher (signer), state
//!                     data: date u32, count u8, then per row:
//!                           key [32], borrow u16, supply u16, depth u64
//!   2 set_publisher   owner (signer), state; data: new publisher (32)
//!   3 set_owner       owner (signer), state; data: new owner (32)
//!
//! Account layout (little-endian):
//!   "SBORFIX1" (8) | owner (32) | publisher (32) | bump (1) | count (1)
//!   then up to 6 rows of: key (32) | date u32 | borrow u16 | supply u16
//!                         | depth u64 | published_at i64

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::{clock::Clock, Sysvar},
};

pub mod state;
use state::*;


#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

impl From<Fail> for ProgramError {
    fn from(f: Fail) -> Self {
        match f {
            Fail::Uninitialized => ProgramError::UninitializedAccount,
            Fail::Unauthorized => ProgramError::MissingRequiredSignature,
            Fail::BadData => ProgramError::InvalidInstructionData,
            Fail::Full => ProgramError::AccountDataTooSmall,
            Fail::AlreadyInitialized => ProgramError::AccountAlreadyInitialized,
        }
    }
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
    let (&tag, rest) = input.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    let it = &mut accounts.iter();
    let signer = next_account_info(it)?;
    let state = next_account_info(it)?;
    if !signer.is_signer { return Err(ProgramError::MissingRequiredSignature); }
    let (pda, bump) = Pubkey::find_program_address(&[SEED], program_id);
    if state.key != &pda { return Err(ProgramError::InvalidSeeds); }

    if tag == 0 {
        let publisher = key32(rest).map_err(ProgramError::from)?;
        let system = next_account_info(it)?;
        if system.key != &system_program::id() { return Err(ProgramError::IncorrectProgramId); }
        if state.owner != program_id {
            let lamports = Rent::get()?.minimum_balance(SPACE);
            invoke_signed(
                &system_instruction::create_account(signer.key, state.key, lamports, SPACE as u64, program_id),
                &[signer.clone(), state.clone(), system.clone()],
                &[&[SEED, &[bump]]],
            )?;
        }
        write_init(&mut state.try_borrow_mut_data()?, &signer.key.to_bytes(), &publisher, bump)?;
        msg!("sbor: initialized");
        return Ok(());
    }

    if state.owner != program_id { return Err(ProgramError::IncorrectProgramId); }
    let mut data = state.try_borrow_mut_data()?;
    let who = signer.key.to_bytes();
    match tag {
        1 => { apply_publish(&mut data, &who, Clock::get()?.unix_timestamp, rest)?; msg!("sbor: published"); }
        2 => { apply_set(&mut data, &who, 40, &key32(rest)?)?; msg!("sbor: publisher changed"); }
        3 => { apply_set(&mut data, &who, 8, &key32(rest)?)?; msg!("sbor: owner changed"); }
        _ => return Err(ProgramError::InvalidInstructionData),
    }
    Ok(())
}

