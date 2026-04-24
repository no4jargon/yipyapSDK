import { createFakeProviderAdapter } from '../../packages/provider-adapter-interface/src/fake-provider-adapter';
import { runProviderAdapterContractTests } from './provider-adapter-contract';

runProviderAdapterContractTests('fake', async () => createFakeProviderAdapter());
