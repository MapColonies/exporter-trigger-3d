import { container } from 'tsyringe';
import { NFSProvider } from './nfsProvider';
import { S3Provider } from './s3Provider';

function getProvider(provider: "NFS" | "S3"): S3Provider | NFSProvider {
  switch (provider) {
    case 'NFS':
      return container.resolve(NFSProvider);
    case 'S3':
      return container.resolve(S3Provider);
  }
}

export { getProvider };
