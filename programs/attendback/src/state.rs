use anchor_lang::prelude::*;
#[account]
#[derive(InitSpace)]
pub struct EventRecord {
    pub id: [u8; 32],
    pub authority: Pubkey,
    pub cancel_deadline: i64,
    pub cancelled: bool,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Terms {
    pub amount: u64,
    pub penalty_bps: u16,
    pub booking_authority: Pubkey,
    pub attester: Pubkey,
    pub resolver: Pubkey,
    pub penalty_recipient: Pubkey,
    pub booking_close: i64,
    pub free_cancel_until: i64,
    pub checkin_open: i64,
    pub checkin_close: i64,
    pub proposal_cutoff: i64,
    pub dispute_deadline: i64,
    pub resolution_deadline: i64,
    pub hard_refund_at: i64,
    pub terms_hash: [u8; 32],
}
#[account]
#[derive(InitSpace)]
pub struct Policy {
    pub event: Pubkey,
    pub id: [u8; 32],
    pub mint: Pubkey,
    pub decimals: u8,
    pub terms: Terms,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum DepositStatus {
    Funded,
    Refundable,
    NoShowProposed,
    Disputed,
    Forfeitable,
    Settled,
}
#[account]
#[derive(InitSpace)]
pub struct Commitment {
    pub policy: Pubkey,
    pub guest: Pubkey,
    pub principal: u64,
    pub status: DepositStatus,
    pub late_cancel: bool,
    pub refund: u64,
    pub penalty: u64,
    pub bump: u8,
}
#[error_code]
pub enum AttendError {
    #[msg("Invalid immutable policy or deadlines")]
    InvalidPolicy,
    #[msg("Action is outside its allowed time window")]
    InvalidTime,
    #[msg("Action is invalid for this deposit state")]
    InvalidState,
    #[msg("EventRecord has been cancelled")]
    Cancelled,
    #[msg("Deposit permit has expired or is invalid")]
    InvalidPermit,
    #[msg("Unauthorized role or recipient")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Arithmetic,
}
impl Terms {
    pub fn validate(&self, now: i64, cancel_deadline: i64) -> Result<()> {
        require!(
            self.amount > 0 && self.penalty_bps <= 10_000,
            AttendError::InvalidPolicy
        );
        require!(
            now < self.booking_close
                && self.booking_close <= self.checkin_close
                && self.free_cancel_until <= self.checkin_open
                && self.checkin_open < self.checkin_close
                && self.checkin_close < self.proposal_cutoff
                && self.proposal_cutoff < self.dispute_deadline
                && self.dispute_deadline <= self.resolution_deadline
                && self.resolution_deadline < self.hard_refund_at
                && now < cancel_deadline
                && cancel_deadline <= self.dispute_deadline,
            AttendError::InvalidPolicy
        );
        for key in [
            self.booking_authority,
            self.attester,
            self.resolver,
            self.penalty_recipient,
        ] {
            require!(key != Pubkey::default(), AttendError::InvalidPolicy);
        }
        Ok(())
    }
}
pub fn penalty_split(principal: u64, bps: u16) -> Result<(u64, u64)> {
    require!(bps <= 10_000, AttendError::InvalidPolicy);
    let penalty = (u128::from(principal)
        .checked_mul(u128::from(bps))
        .ok_or(AttendError::Arithmetic)?
        / 10_000) as u64;
    Ok((
        principal
            .checked_sub(penalty)
            .ok_or(AttendError::Arithmetic)?,
        penalty,
    ))
}
