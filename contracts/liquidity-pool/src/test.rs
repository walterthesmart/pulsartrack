#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, token::StellarAssetClient, Address, Env};

fn deploy_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}
fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

fn setup(env: &Env) -> (LiquidityPoolContractClient<'_>, Address, Address, Address) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = deploy_token(env, &token_admin);
    let contract_id = env.register_contract(None, LiquidityPoolContract);
    let c = LiquidityPoolContractClient::new(env, &contract_id);
    c.initialize(&admin, &token);
    (c, admin, token_admin, token)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    setup(&env);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, admin, _, token) = setup(&env);
    c.initialize(&admin, &token);
}

#[test]
fn test_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    mint(&env, &token, &provider, 1_000_000);
    let shares = c.deposit(&provider, &100_000i128);
    assert!(shares > 0);
    let pos = c.get_provider_position(&provider).unwrap();
    assert_eq!(pos.shares, shares);
    let pool = c.get_pool_state();
    assert_eq!(pool.total_liquidity, 100_000);
}

#[test]
fn test_withdraw() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    mint(&env, &token, &provider, 1_000_000);
    let shares = c.deposit(&provider, &100_000i128);
    let withdrawn = c.withdraw(&provider, &shares);
    assert_eq!(withdrawn, 100_000);
    let pool = c.get_pool_state();
    assert_eq!(pool.total_liquidity, 0);
}

#[test]
fn test_borrow() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    mint(&env, &token, &provider, 1_000_000);
    c.deposit(&provider, &500_000i128);
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    let borrow = c.get_borrow(&1u64).unwrap();
    assert_eq!(borrow.borrowed, 100_000);
    let pool = c.get_pool_state();
    assert_eq!(pool.total_borrowed, 100_000);
}

#[test]
fn test_repay() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower, 1_000_000);
    c.deposit(&provider, &500_000i128);
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    
    // Repay immediately (no time elapsed, minimal interest)
    c.repay(&borrower, &1u64, &100_000i128);
    let pool = c.get_pool_state();
    assert_eq!(pool.total_borrowed, 0);
}

#[test]
fn test_get_provider_position_nonexistent() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, _) = setup(&env);
    assert!(c.get_provider_position(&Address::generate(&env)).is_none());
}

#[test]
fn test_get_borrow_nonexistent() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, _) = setup(&env);
    assert!(c.get_borrow(&999u64).is_none());
}

#[test]
fn test_repay_with_interest_no_inflation() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower, 1_000_000);
    
    // Provider deposits 500,000
    c.deposit(&provider, &500_000i128);
    let pool_after_deposit = c.get_pool_state();
    assert_eq!(pool_after_deposit.total_liquidity, 500_000);
    
    // Borrower borrows 100,000
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    let pool_after_borrow = c.get_pool_state();
    assert_eq!(pool_after_borrow.total_liquidity, 500_000);
    assert_eq!(pool_after_borrow.total_borrowed, 100_000);
    
    // Advance time by 1 year to accrue interest
    env.ledger().with_mut(|li| {
        li.timestamp += 31_557_600;
    });
    
    // Borrower repays with interest
    c.repay(&borrower, &1u64, &110_000i128);
    let pool_after_repay = c.get_pool_state();
    
    // total_liquidity should remain unchanged
    assert_eq!(pool_after_repay.total_liquidity, 500_000);
    assert_eq!(pool_after_repay.total_borrowed, 0);
    // Interest should be in reserve (approximately 5,000)
    assert!(pool_after_repay.interest_reserve >= 4_900 && pool_after_repay.interest_reserve <= 5_100);
}

#[test]
fn test_repay_principal_only() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower, 1_000_000);
    
    c.deposit(&provider, &500_000i128);
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    
    // Repay immediately (minimal time elapsed, negligible interest)
    c.repay(&borrower, &1u64, &100_000i128);
    let pool = c.get_pool_state();
    
    assert_eq!(pool.total_liquidity, 500_000);
    assert_eq!(pool.total_borrowed, 0);
    // Interest should be minimal (close to 0)
    assert!(pool.interest_reserve < 10);
}

#[test]
fn test_multiple_borrows_with_interest() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower1 = Address::generate(&env);
    let borrower2 = Address::generate(&env);
    
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower1, 1_000_000);
    mint(&env, &token, &borrower2, 1_000_000);
    
    // Provider deposits 500,000
    c.deposit(&provider, &500_000i128);
    
    // Two borrowers borrow
    c.borrow(&borrower1, &1u64, &100_000i128, &86_400u64);
    c.borrow(&borrower2, &2u64, &150_000i128, &86_400u64);
    
    let pool_after_borrows = c.get_pool_state();
    assert_eq!(pool_after_borrows.total_liquidity, 500_000);
    assert_eq!(pool_after_borrows.total_borrowed, 250_000);
    
    // Advance time by 1 year
    env.ledger().with_mut(|li| {
        li.timestamp += 31_557_600;
    });
    
    // First borrower repays with interest (~5% of 100k = ~5k)
    c.repay(&borrower1, &1u64, &110_000i128);
    let pool_after_first = c.get_pool_state();
    assert_eq!(pool_after_first.total_liquidity, 500_000);
    assert_eq!(pool_after_first.total_borrowed, 150_000);
    assert!(pool_after_first.interest_reserve >= 4_900 && pool_after_first.interest_reserve <= 5_100);
    
    // Second borrower repays with interest (~5% of 150k = ~7.5k)
    c.repay(&borrower2, &2u64, &160_000i128);
    let pool_after_second = c.get_pool_state();
    assert_eq!(pool_after_second.total_liquidity, 500_000);
    assert_eq!(pool_after_second.total_borrowed, 0);
    // Total interest should be ~12.5k (5k + 7.5k)
    assert!(pool_after_second.interest_reserve >= 12_000 && pool_after_second.interest_reserve <= 13_000);
}

#[test]
fn test_provider_shares_not_inflated_by_interest() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower, 1_000_000);
    
    // Provider deposits and gets shares
    let shares = c.deposit(&provider, &500_000i128);
    
    // Borrower borrows
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    
    // Advance time by 1 year
    env.ledger().with_mut(|li| {
        li.timestamp += 31_557_600;
    });
    
    // Borrower repays with interest
    c.repay(&borrower, &1u64, &110_000i128);
    
    // Provider's shares should still be worth the same as original deposit
    let pool = c.get_pool_state();
    let position = c.get_provider_position(&provider).unwrap();
    
    // Share value calculation: (shares * total_liquidity) / total_shares
    // Should equal original deposit, not inflated by interest
    assert_eq!(position.shares, shares);
    assert_eq!(pool.total_liquidity, 500_000); // Not inflated
    // Interest tracked separately
    assert!(pool.interest_reserve >= 4_900 && pool.interest_reserve <= 5_100);
}

#[test]
fn test_repay_partial_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower, 1_000_000);
    
    c.deposit(&provider, &500_000i128);
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    
    // Repay immediately (no time elapsed, minimal interest)
    c.repay(&borrower, &1u64, &100_000i128);
    let pool = c.get_pool_state();
    
    assert_eq!(pool.total_borrowed, 0);
    assert_eq!(pool.total_liquidity, 500_000); // Unchanged
    
    // Borrow record should be removed
    assert!(c.get_borrow(&1u64).is_none());
}

#[test]
fn test_accrue_interest() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower, 1_000_000);
    
    c.deposit(&provider, &500_000i128);
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    
    // Advance time by 1 year (31,557,600 seconds)
    env.ledger().with_mut(|li| {
        li.timestamp += 31_557_600;
    });
    
    // Accrue interest
    let interest = c.accrue_interest(&1u64);
    
    // At 5% annual rate on 100,000: interest should be ~5,000
    assert!(interest >= 4_900 && interest <= 5_100);
    
    let borrow = c.get_borrow(&1u64).unwrap();
    assert_eq!(borrow.interest_accrued, interest);
}

#[test]
fn test_repay_with_accrued_interest() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower, 1_000_000);
    
    c.deposit(&provider, &500_000i128);
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    
    // Advance time by 1 year
    env.ledger().with_mut(|li| {
        li.timestamp += 31_557_600;
    });
    
    // Repay with interest (100,000 + ~5,000)
    c.repay(&borrower, &1u64, &105_500i128);
    
    let pool = c.get_pool_state();
    assert_eq!(pool.total_borrowed, 0);
    assert!(pool.interest_reserve >= 4_900 && pool.interest_reserve <= 5_100);
}

#[test]
#[should_panic(expected = "insufficient payment")]
fn test_repay_insufficient_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower, 1_000_000);
    
    c.deposit(&provider, &500_000i128);
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    
    // Advance time by 1 year
    env.ledger().with_mut(|li| {
        li.timestamp += 31_557_600;
    });
    
    // Try to repay only principal (should fail due to accrued interest)
    c.repay(&borrower, &1u64, &100_000i128);
}

#[test]
fn test_interest_calculation_over_time() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower, 1_000_000);
    
    c.deposit(&provider, &500_000i128);
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    
    // Check interest after 6 months
    env.ledger().with_mut(|li| {
        li.timestamp += 15_778_800; // ~6 months
    });
    
    let interest_6mo = c.accrue_interest(&1u64);
    assert!(interest_6mo >= 2_400 && interest_6mo <= 2_600); // ~2.5% of 100k
    
    // Check interest after another 6 months (1 year total)
    env.ledger().with_mut(|li| {
        li.timestamp += 15_778_800;
    });
    
    let interest_1yr = c.accrue_interest(&1u64);
    assert!(interest_1yr >= 4_900 && interest_1yr <= 5_100); // ~5% of 100k
}

#[test]
fn test_repay_with_overpayment() {
    let env = Env::default();
    env.mock_all_auths();
    let (c, _, _, token) = setup(&env);
    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    
    mint(&env, &token, &provider, 1_000_000);
    mint(&env, &token, &borrower, 1_000_000);
    
    c.deposit(&provider, &500_000i128);
    c.borrow(&borrower, &1u64, &100_000i128, &86_400u64);
    
    // Advance time by 1 year
    env.ledger().with_mut(|li| {
        li.timestamp += 31_557_600;
    });
    
    // Repay with overpayment (should return excess)
    c.repay(&borrower, &1u64, &110_000i128);
    
    let pool = c.get_pool_state();
    assert_eq!(pool.total_borrowed, 0);
    assert!(pool.interest_reserve >= 4_900 && pool.interest_reserve <= 5_100);
}
