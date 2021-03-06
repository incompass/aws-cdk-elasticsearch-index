import { Construct, CustomResource, Duration } from '@aws-cdk/core';
import { Asset } from '@aws-cdk/aws-s3-assets';
import { IVpc } from '@aws-cdk/aws-ec2';
import { Code, Function, Runtime, Tracing } from '@aws-cdk/aws-lambda';
import { Provider } from '@aws-cdk/custom-resources';
import * as path from 'path';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { INDEX_NAME_KEY } from '../src/constants';

export interface ElasticsearchIndexProps {
  mappingJSONPath: string;
  elasticSearchIndex: string;
  elasticSearchEndpoint: string;
  vpc?: IVpc;
  policyArn?: string;
  queryInterval?: Duration;
  totalTimeout?: Duration;
}

export class ElasticsearchIndex extends Construct {
  readonly indexName: string;

  constructor(
    scope: Construct,
    id: string,
    props: ElasticsearchIndexProps,
    onEventCodePath: string = path.join(
      __dirname,
      '..',
      'resources',
      'on-event'
    ),
    isCompleteCodePath: string = path.join(
      __dirname,
      '..',
      'resources',
      'is-complete'
    )
  ) {
    super(scope, id);

    const mappingJSONAsset = new Asset(this, 'IndexCreatorMappingJSON', {
      path: props.mappingJSONPath,
    });

    const isCompleteHandler = new Function(this, 'IsCompleteHandler', {
      runtime: Runtime.NODEJS_14_X,
      code: Code.fromAsset(isCompleteCodePath),
      handler: 'is-complete.handler',
      environment: {
        ELASTICSEARCH_ENDPOINT: props.elasticSearchEndpoint,
        ELASTICSEARCH_INDEX: props.elasticSearchIndex,
      },
      timeout: Duration.minutes(1),
      vpc: props.vpc,
      tracing: Tracing.ACTIVE,
    });

    const onEventHandler = new Function(this, 'OnEventHandler', {
      runtime: Runtime.NODEJS_12_X,
      code: Code.fromAsset(onEventCodePath),
      handler: 'on-event.handler',
      environment: {
        ELASTICSEARCH_ENDPOINT: props.elasticSearchEndpoint,
        ELASTICSEARCH_INDEX: props.elasticSearchIndex,
        S3_BUCKET_NAME: mappingJSONAsset.s3BucketName,
        S3_OBJECT_KEY: mappingJSONAsset.s3ObjectKey,
        S3_URL: mappingJSONAsset.httpUrl,
      },
      timeout: Duration.minutes(14),
      vpc: props.vpc,
      tracing: Tracing.ACTIVE,
    });

    mappingJSONAsset.grantRead(onEventHandler);

    if (props.policyArn) {
      isCompleteHandler.addToRolePolicy(
        new PolicyStatement({
          actions: ['es:ESHttpGet', 'es:ESHttpHead', 'es:ESHttpPut'],
          resources: [props.policyArn],
        })
      );
      onEventHandler.addToRolePolicy(
        new PolicyStatement({
          actions: ['es:ESHttpGet', 'es:ESHttpHead', 'es:ESHttpPut'],
          resources: [props.policyArn],
        })
      );
    }

    const provider = new Provider(this, 'ElasticsearchIndexProvider', {
      onEventHandler,
      isCompleteHandler,
      queryInterval: props.queryInterval ?? Duration.minutes(2),
      totalTimeout: props.totalTimeout ?? Duration.minutes(60),
    });

    const resource = new CustomResource(this, 'ElasticsearchIndex', {
      serviceToken: provider.serviceToken,
      properties: {
        mappingJSONPath: props.mappingJSONPath,
      },
    });

    this.indexName = resource.getAttString(INDEX_NAME_KEY);
  }
}
