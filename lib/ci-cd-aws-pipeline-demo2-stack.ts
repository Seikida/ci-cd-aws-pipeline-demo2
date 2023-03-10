import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
// import { KeyPair } from 'cdk-ec2-key-pair';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { CodePipeline, CodePipelineSource, ShellStep, Step } from 'aws-cdk-lib/pipelines';

export class CiCdAwsPipelineDemo2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'CiCdAwsPipelineDemo2Queue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });


    function cdkToolkitLookupRoleArn(stack: cdk.Stack, cdkToolkitQualifier?: string): string {
      const synthesizer = stack.synthesizer
      if (synthesizer instanceof cdk.DefaultStackSynthesizer) {
        const qualifier = (
          cdkToolkitQualifier
          ?? stack.node.tryGetContext(cdk.BOOTSTRAP_QUALIFIER_CONTEXT)
          ?? cdk.DefaultStackSynthesizer.DEFAULT_QUALIFIER
        )
        let s = cdk.DefaultStackSynthesizer.DEFAULT_LOOKUP_ROLE_ARN
        s = s.replace(/\$\{AWS::AccountId}/g, stack.account)
        s = s.replace(/\$\{AWS::Partition}/g, stack.partition)
        s = s.replace(/\$\{AWS::Region}/g, stack.region)
        s = s.replace(/\$\{Qualifier}/g, qualifier)
        return s
      } else {
        throw new Error(`cdkToolkitLookupRoleArn only works with a DefaultStackSynthesizer and not ${synthesizer}`)
      }
    }

    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: 'TestPipeline2',
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.gitHub('Seikida/ci-cd-aws-pipeline-demo2', 'main'), //Remember to change 
        commands: [
          'npm ci', 
          'npm run build', 
          'npx cdk synth'
        ]
      }),

      // Allow the CDK application to perform lookups of the environment during synthesis.
      synthCodeBuildDefaults: {
        rolePolicy: [
          new iam.PolicyStatement({
            actions: [ 'sts:AssumeRole' ],
            resources: [ cdkToolkitLookupRoleArn(this) ],
          }),
        ],
      },


    });

    // Next...


    // Create a Key Pair to be used with this EC2 Instance
    // Temporarily disabled since `cdk-ec2-key-pair` is not yet CDK v2 compatible
    // const key = new KeyPair(this, 'KeyPair', {
    //   name: 'cdk-keypair',
    //   description: 'Key Pair created with CDK Deployment',
    // });
    // key.grantReadOnPublicKey

    // // Look up the default VPC
    // const vpc = ec2.Vpc.fromLookup(this, "VPC", {
    //  isDefault: true
    // });

    // Create new VPC with 2 Subnets
    const vpc = new ec2.Vpc(this, 'VPC', {
      natGateways: 0,
      subnetConfiguration: [{
        cidrMask: 24,
        name: "asterisk",
        subnetType: ec2.SubnetType.PUBLIC
      }]
    });

    // Allow SSH (TCP Port 22) access from anywhere
    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      description: 'Allow SSH (TCP port 22) in',
      allowAllOutbound: true
    });

    // Allow SSH access on port tcp/22
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(), 
      ec2.Port.tcp(22), 
      'Allow SSH Access'
    );

    // Allow HTTP access on port tcp/80
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP Access"
    );

    // IAM role to allow access to other AWS services
    const role = new iam.Role(this, 'ec2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
    });

    // IAM policy attachment to allow access to 
    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );

    /*
    // Use Latest Amazon Linux Image - CPU Type ARM64
    // For T4.micro
    const ami = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      cpuType: ec2.AmazonLinuxCpuType.ARM_64
    });

    // Create the instance using the Security Group, AMI, and KeyPair defined in the VPC created
    const ec2Instance = new ec2.Instance(this, 'Instance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4, ec2.InstanceSize.MICRO),
      machineImage: ami,
      securityGroup: securityGroup,
      // keyName: key.keyPairName,
      role: role
    });
    */

    // Look up the AMI Id for the Amazon Linux 2 Image with CPU Type X86_64
    const ami = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });

    // Create the EC2 instance using the Security Group, AMI, and KeyPair defined.
    // https://aws.amazon.com/jp/getting-started/guides/deploy-webapp-ec2/module-one/
    const ec2Instance = new ec2.Instance(this, "Instance", {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ami,
      securityGroup: securityGroup,
      // keyName: key.keyPairName,
      role: role,
    });

    // Create an asset that will be used as part of User Data to run on first load
    // https://docs.aws.amazon.com/cdk/v2/guide/assets.html
    const asset = new Asset(this, 'Asset', { path: path.join(__dirname, '../src/config.sh') });
    const localPath = ec2Instance.userData.addS3DownloadCommand({
      bucket: asset.bucket,
      bucketKey: asset.s3ObjectKey,
    });

    ec2Instance.userData.addExecuteFileCommand({
      filePath: localPath,
      arguments: '--verbose -y'
    });
    asset.grantRead(ec2Instance.role);

    // Create outputs for connecting
    new cdk.CfnOutput(this, 'IP Address', { value: ec2Instance.instancePublicIp });
    // new cdk.CfnOutput(this, 'Key Name', { value: key.keyPairName })
    new cdk.CfnOutput(this, 'Download Key Command', { value: 'aws secretsmanager get-secret-value --secret-id ec2-ssh-key/cdk-keypair/private --query SecretString --output text > cdk-key.pem && chmod 400 cdk-key.pem' })
    new cdk.CfnOutput(this, 'ssh command', { value: 'ssh -i cdk-key.pem -o IdentitiesOnly=yes ec2-user@' + ec2Instance.instancePublicIp })
    

  }
}
