use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
#[derive(Accounts)]
#[instruction(id: [u8;32])]
pub struct CreateEvent<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init,payer=authority,space=8+EventRecord::INIT_SPACE,seeds=[b"event",authority.key().as_ref(),&id],bump)]
    pub event: Account<'info, EventRecord>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(id: [u8;32])]
pub struct PublishPolicy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one=authority)]
    pub event: Account<'info, EventRecord>,
    #[account(init,payer=authority,space=8+Policy::INIT_SPACE,seeds=[b"policy",event.key().as_ref(),&id],bump)]
    pub policy: Account<'info, Policy>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub guest: Signer<'info>,
    #[account(address=policy.terms.booking_authority @ AttendError::Unauthorized)]
    pub booking_authority: Signer<'info>,
    pub event: Account<'info, EventRecord>,
    #[account(has_one=event,has_one=mint)]
    pub policy: Account<'info, Policy>,
    #[account(init,payer=guest,space=8+Commitment::INIT_SPACE,seeds=[b"commitment",policy.key().as_ref(),guest.key().as_ref()],bump)]
    pub commitment: Account<'info, Commitment>,
    #[account(init,payer=guest,seeds=[b"vault",commitment.key().as_ref()],bump,token::mint=mint,token::authority=commitment)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut,token::mint=mint,token::authority=guest)]
    pub source: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct GuestAction<'info> {
    pub guest: Signer<'info>,
    #[account(has_one=event)]
    pub policy: Account<'info, Policy>,
    pub event: Account<'info, EventRecord>,
    #[account(mut,has_one=policy,has_one=guest,seeds=[b"commitment",policy.key().as_ref(),guest.key().as_ref()],bump=commitment.bump)]
    pub commitment: Account<'info, Commitment>,
}
#[derive(Accounts)]
pub struct AttesterAction<'info> {
    #[account(address=policy.terms.attester @ AttendError::Unauthorized)]
    pub attester: Signer<'info>,
    #[account(has_one=event)]
    pub policy: Account<'info, Policy>,
    pub event: Account<'info, EventRecord>,
    #[account(mut,has_one=policy)]
    pub commitment: Account<'info, Commitment>,
}
#[derive(Accounts)]
pub struct ResolverAction<'info> {
    #[account(address=policy.terms.resolver @ AttendError::Unauthorized)]
    pub resolver: Signer<'info>,
    #[account(has_one=event)]
    pub policy: Account<'info, Policy>,
    pub event: Account<'info, EventRecord>,
    #[account(mut,has_one=policy)]
    pub commitment: Account<'info, Commitment>,
}
#[derive(Accounts)]
pub struct CancelEvent<'info> {
    pub authority: Signer<'info>,
    #[account(mut,has_one=authority)]
    pub event: Account<'info, EventRecord>,
}
#[derive(Accounts)]
pub struct Settle<'info> {
    pub event: Account<'info, EventRecord>,
    #[account(has_one=event,has_one=mint)]
    pub policy: Account<'info, Policy>,
    #[account(mut,has_one=policy,seeds=[b"commitment",policy.key().as_ref(),commitment.guest.as_ref()],bump=commitment.bump)]
    pub commitment: Account<'info, Commitment>,
    #[account(mut,seeds=[b"vault",commitment.key().as_ref()],bump,token::mint=mint,token::authority=commitment)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut,associated_token::mint=mint,associated_token::authority=commitment.guest)]
    pub guest_tokens: Account<'info, TokenAccount>,
    #[account(mut,associated_token::mint=mint,associated_token::authority=policy.terms.penalty_recipient)]
    pub penalty_tokens: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}
