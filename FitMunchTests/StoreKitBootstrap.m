#import <Foundation/Foundation.h>
#import <StoreKitTest/StoreKitTest.h>

/// Installed when the unit-test bundle loads, which is before the host app
/// calls StoreKit. A session created in setUp is too late: Product.products
/// has already hit the live store.
static SKTestSession *fitmunchStoreKitSession = nil;

__attribute__((constructor))
static void FitMunchInstallStoreKitConfiguration(void) {
    NSError *error = nil;
    fitmunchStoreKitSession = [[SKTestSession alloc] initWithConfigurationFileNamed:@"FitMunchProducts" error:&error];
    if (fitmunchStoreKitSession == nil) {
        NSLog(@"SKTestSession FitMunchProducts failed: %@", error);
        return;
    }
    fitmunchStoreKitSession.disableDialogs = YES;
    [fitmunchStoreKitSession resetToDefaultState];
    NSLog(@"SKTestSession FitMunchProducts installed");
}
