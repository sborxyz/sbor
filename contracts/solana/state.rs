//! The rules of SBOR's Solana program on raw account bytes, with no Solana
//! dependency, so they can be tested anywhere. See lib.rs for the layout.

pub const SEED: &[u8] = b"sbor-fixings";
pub const MAGIC: &[u8; 8] = b"SBORFIX1";
pub const MAX_ROWS: usize = 6;
pub const ROW: usize = 32 + 4 + 2 + 2 + 8 + 8;
pub const HEADER: usize = 8 + 32 + 32 + 1 + 1;
pub const SPACE: usize = HEADER + MAX_ROWS * ROW;
pub const IN_ROW: usize = 32 + 2 + 2 + 8;

#[derive(Debug, PartialEq)]
pub enum Fail { Uninitialized, Unauthorized, BadData, Full, AlreadyInitialized }


pub fn key32(b: &[u8]) -> Result<[u8; 32], Fail> {
    b.try_into().map_err(|_| Fail::BadData)
}

/* State logic on raw bytes, so it can be tested without a Solana node. */

pub fn write_init(data: &mut [u8], owner: &[u8; 32], publisher: &[u8; 32], bump: u8) -> Result<(), Fail> {
    if data.len() < SPACE { return Err(Fail::Full); }
    if &data[0..8] == MAGIC { return Err(Fail::AlreadyInitialized); }
    data[0..8].copy_from_slice(MAGIC);
    data[8..40].copy_from_slice(owner);
    data[40..72].copy_from_slice(publisher);
    data[72] = bump;
    data[73] = 0;
    Ok(())
}

fn check(data: &[u8]) -> Result<(), Fail> {
    if data.len() < SPACE || &data[0..8] != MAGIC { return Err(Fail::Uninitialized); }
    Ok(())
}

pub fn apply_publish(data: &mut [u8], signer: &[u8; 32], now: i64, payload: &[u8]) -> Result<(), Fail> {
    check(data)?;
    if &data[40..72] != signer { return Err(Fail::Unauthorized); }
    if payload.len() < 5 { return Err(Fail::BadData); }
    let date = u32::from_le_bytes(payload[0..4].try_into().unwrap());
    let n = payload[4] as usize;
    if n == 0 || payload.len() != 5 + n * IN_ROW { return Err(Fail::BadData); }
    for i in 0..n {
        let r = &payload[5 + i * IN_ROW..5 + (i + 1) * IN_ROW];
        let key = &r[0..32];
        let borrow = u16::from_le_bytes([r[32], r[33]]);
        let supply = u16::from_le_bytes([r[34], r[35]]);
        if borrow > 10_000 || supply > 10_000 { return Err(Fail::BadData); }
        let count = data[73] as usize;
        let slot = (0..count).find(|&j| &data[HEADER + j * ROW..HEADER + j * ROW + 32] == key);
        let j = match slot {
            Some(j) => j,
            None => {
                if count >= MAX_ROWS { return Err(Fail::Full); }
                data[73] = (count + 1) as u8;
                count
            }
        };
        let o = HEADER + j * ROW;
        data[o..o + 32].copy_from_slice(key);
        data[o + 32..o + 36].copy_from_slice(&date.to_le_bytes());
        data[o + 36..o + 38].copy_from_slice(&r[32..34]);
        data[o + 38..o + 40].copy_from_slice(&r[34..36]);
        data[o + 40..o + 48].copy_from_slice(&r[36..44]);
        data[o + 48..o + 56].copy_from_slice(&now.to_le_bytes());
    }
    Ok(())
}

pub fn apply_set(data: &mut [u8], signer: &[u8; 32], field: usize, new: &[u8; 32]) -> Result<(), Fail> {
    check(data)?;
    if &data[8..40] != signer { return Err(Fail::Unauthorized); }
    data[field..field + 32].copy_from_slice(new);
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    const OWNER: [u8; 32] = [1; 32];
    const PUBL: [u8; 32] = [2; 32];
    const OTHER: [u8; 32] = [3; 32];
    fn key(s: &str) -> [u8; 32] { let mut k = [0u8; 32]; k[..s.len()].copy_from_slice(s.as_bytes()); k }
    fn payload(date: u32, rows: &[(&str, u16, u16, u64)]) -> Vec<u8> {
        let mut v = date.to_le_bytes().to_vec(); v.push(rows.len() as u8);
        for (k, b, s, d) in rows { v.extend_from_slice(&key(k)); v.extend_from_slice(&b.to_le_bytes()); v.extend_from_slice(&s.to_le_bytes()); v.extend_from_slice(&d.to_le_bytes()); }
        v
    }
    fn fresh() -> Vec<u8> { let mut d = vec![0u8; SPACE]; write_init(&mut d, &OWNER, &PUBL, 254).unwrap(); d }
    fn row(d: &[u8], j: usize) -> (u32, u16, u16, u64, i64) {
        let o = HEADER + j * ROW;
        (u32::from_le_bytes(d[o+32..o+36].try_into().unwrap()), u16::from_le_bytes(d[o+36..o+38].try_into().unwrap()),
         u16::from_le_bytes(d[o+38..o+40].try_into().unwrap()), u64::from_le_bytes(d[o+40..o+48].try_into().unwrap()),
         i64::from_le_bytes(d[o+48..o+56].try_into().unwrap()))
    }

    #[test] fn space_is_small() { assert_eq!(SPACE, 410); }
    #[test] fn init_twice_refused() { let mut d = fresh(); assert_eq!(write_init(&mut d, &OWNER, &PUBL, 1), Err(Fail::AlreadyInitialized)); }
    #[test] fn publisher_posts_and_updates_in_place() {
        let mut d = fresh();
        apply_publish(&mut d, &PUBL, 100, &payload(20261007, &[("SBOR-USD", 275, 88, 15_631_547), ("SBOR-STX", 175, 78, 7_315_270)])).unwrap();
        assert_eq!(d[73], 2);
        assert_eq!(row(&d, 0), (20261007, 275, 88, 15_631_547, 100));
        apply_publish(&mut d, &PUBL, 200, &payload(20261008, &[("SBOR-USD", 280, 90, 15_700_000)])).unwrap();
        assert_eq!(d[73], 2, "same key updates its row, no new row");
        assert_eq!(row(&d, 0), (20261008, 280, 90, 15_700_000, 200));
        assert_eq!(row(&d, 1).0, 20261007, "an index not posted keeps its last date");
    }
    #[test] fn only_publisher_posts() { let mut d = fresh(); assert_eq!(apply_publish(&mut d, &OTHER, 1, &payload(1, &[("A", 1, 1, 1)])), Err(Fail::Unauthorized)); }
    #[test] fn bad_payloads_refused() {
        let mut d = fresh();
        assert_eq!(apply_publish(&mut d, &PUBL, 1, &[1, 2]), Err(Fail::BadData));
        let mut p = payload(1, &[("A", 1, 1, 1)]); p.pop();
        assert_eq!(apply_publish(&mut d, &PUBL, 1, &p), Err(Fail::BadData));
        assert_eq!(apply_publish(&mut d, &PUBL, 1, &payload(1, &[("A", 10_001, 1, 1)])), Err(Fail::BadData));
        assert_eq!(apply_publish(&mut d, &PUBL, 1, &payload(1, &[])), Err(Fail::BadData));
    }
    #[test] fn at_most_six_benchmarks() {
        let mut d = fresh();
        apply_publish(&mut d, &PUBL, 1, &payload(1, &[("A",1,1,1),("B",1,1,1),("C",1,1,1),("D",1,1,1),("E",1,1,1),("F",1,1,1)])).unwrap();
        assert_eq!(apply_publish(&mut d, &PUBL, 1, &payload(1, &[("G", 1, 1, 1)])), Err(Fail::Full));
    }
    #[test] fn owner_controls_publisher() {
        let mut d = fresh();
        assert_eq!(apply_set(&mut d, &PUBL, 40, &OTHER), Err(Fail::Unauthorized));
        apply_set(&mut d, &OWNER, 40, &OTHER).unwrap();
        assert_eq!(apply_publish(&mut d, &PUBL, 1, &payload(1, &[("A", 1, 1, 1)])), Err(Fail::Unauthorized), "old publisher locked out");
        apply_publish(&mut d, &OTHER, 1, &payload(1, &[("A", 1, 1, 1)])).unwrap();
    }
    #[test] fn uninitialized_refused() { let mut d = vec![0u8; SPACE]; assert_eq!(apply_publish(&mut d, &PUBL, 1, &payload(1, &[("A",1,1,1)])), Err(Fail::Uninitialized)); }
}

