use anchor_lang::prelude::*;
use anchor_spl::token::{self, TransferChecked};
pub mod contexts;
pub mod state;
use contexts::*;
use state::*;
declare_id!("6CUM27mNoskjKnCsoywCQz4puZfhpXj5DJWEDZJuiwuV");
#[program]
pub mod attendback {
    use super::*;
    pub fn create_event(
        ctx: Context<CreateEvent>,
        id: [u8; 32],
        cancel_deadline: i64,
    ) -> Result<()> {
        require!(
            Clock::get()?.unix_timestamp < cancel_deadline,
            AttendError::InvalidTime
        );
        ctx.accounts.event.set_inner(EventRecord {
            id,
            authority: ctx.accounts.authority.key(),
            cancel_deadline,
            cancelled: false,
            bump: ctx.bumps.event,
        });
        Ok(())
    }
    pub fn publish_policy(ctx: Context<PublishPolicy>, id: [u8; 32], terms: Terms) -> Result<()> {
        require!(!ctx.accounts.event.cancelled, AttendError::Cancelled);
        terms.validate(
            Clock::get()?.unix_timestamp,
            ctx.accounts.event.cancel_deadline,
        )?;
        ctx.accounts.policy.set_inner(Policy {
            event: ctx.accounts.event.key(),
            id,
            mint: ctx.accounts.mint.key(),
            decimals: ctx.accounts.mint.decimals,
            terms,
            bump: ctx.bumps.policy,
        });
        Ok(())
    }
    pub fn deposit(ctx: Context<Deposit>, permit_expires: i64) -> Result<()> {
        let p = &ctx.accounts.policy;
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.event.cancelled, AttendError::Cancelled);
        require!(
            now < p.terms.booking_close
                && now < permit_expires
                && permit_expires <= p.terms.booking_close
                && permit_expires <= now.saturating_add(600),
            AttendError::InvalidPermit
        );
        require!(
            ctx.accounts.guest.key() != p.terms.penalty_recipient,
            AttendError::Unauthorized
        );
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.guest.to_account_info(),
                },
            ),
            p.terms.amount,
            p.decimals,
        )?;
        ctx.accounts.commitment.set_inner(Commitment {
            policy: p.key(),
            guest: ctx.accounts.guest.key(),
            principal: p.terms.amount,
            status: DepositStatus::Funded,
            late_cancel: false,
            refund: 0,
            penalty: 0,
            bump: ctx.bumps.commitment,
        });
        Ok(())
    }
    pub fn cancel_registration(ctx: Context<GuestAction>) -> Result<()> {
        let c = &mut ctx.accounts.commitment;
        require!(
            c.status == DepositStatus::Funded && !c.late_cancel,
            AttendError::InvalidState
        );
        if Clock::get()?.unix_timestamp < ctx.accounts.policy.terms.free_cancel_until
            || ctx.accounts.event.cancelled
        {
            c.status = DepositStatus::Refundable;
        } else {
            c.late_cancel = true;
        }
        Ok(())
    }
    pub fn attest_present(ctx: Context<AttesterAction>) -> Result<()> {
        let c = &mut ctx.accounts.commitment;
        let p = &ctx.accounts.policy.terms;
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.event.cancelled, AttendError::Cancelled);
        require!(
            now >= p.checkin_open && now < p.dispute_deadline,
            AttendError::InvalidTime
        );
        require!(
            !c.late_cancel
                && (c.status == DepositStatus::Funded || c.status == DepositStatus::NoShowProposed),
            AttendError::InvalidState
        );
        c.status = DepositStatus::Refundable;
        Ok(())
    }
    pub fn cancel_event(ctx: Context<CancelEvent>) -> Result<()> {
        require!(
            Clock::get()?.unix_timestamp < ctx.accounts.event.cancel_deadline,
            AttendError::InvalidTime
        );
        ctx.accounts.event.cancelled = true;
        Ok(())
    }
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        settle_inner(ctx, false)
    }
    pub fn timeout_refund(ctx: Context<Settle>) -> Result<()> {
        settle_inner(ctx, true)
    }
}
fn settle_inner(ctx: Context<Settle>, timeout_only: bool) -> Result<()> {
    let c = &ctx.accounts.commitment;
    let p = &ctx.accounts.policy;
    let now = Clock::get()?.unix_timestamp;
    require!(
        c.status != DepositStatus::Settled,
        AttendError::InvalidState
    );
    if timeout_only {
        require!(now >= p.terms.hard_refund_at, AttendError::InvalidTime);
    }
    require!(
        ctx.accounts.event.cancelled
            || now >= p.terms.hard_refund_at
            || c.status == DepositStatus::Refundable,
        AttendError::InvalidState
    );
    let refund = c.principal;
    let bump = [c.bump];
    let policy_key = p.key();
    let seeds: &[&[u8]] = &[b"commitment", policy_key.as_ref(), c.guest.as_ref(), &bump];
    let signer = &[seeds];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.guest_tokens.to_account_info(),
                authority: c.to_account_info(),
            },
            signer,
        ),
        refund,
        p.decimals,
    )?;
    let c = &mut ctx.accounts.commitment;
    c.status = DepositStatus::Settled;
    c.refund = refund;
    c.penalty = 0;
    Ok(())
}
