export const DEMO_SAMPLES = {
  textZh: {
    title: '中文 → 英文',
    description: '科技产品介绍',
    input: `小米生态系统致力于为用户提供无缝的智能生活体验。
通过 MiMo Connect 协议，所有小米设备可以实现即时发现、
自动连接和智能协同。无论是手机、平板、电视还是智能家居，
都能在一个统一的平台上实现完美联动。`,
    result: {
      sourceLanguage: 'zh' as const,
      targetLanguage: 'en' as const,
      translation: `The Xiaomi ecosystem is committed to delivering a seamless smart living experience for users.
Through the MiMo Connect protocol, all Xiaomi devices can achieve instant discovery,
automatic connection, and intelligent coordination. Whether it's a phone, tablet, TV, or smart home device,
they can all work together perfectly on a unified platform.`,
      segments: [],
      notes: [
        {
          source: 'MiMo Connect',
          translation: 'MiMo Connect',
          reason: '按照通用规范保留品牌名称'
        }
      ]
    }
  },
  
  textEn: {
    title: '英文 → 中文',
    description: '技术文档',
    input: `The architecture employs a microservices pattern with event-driven communication. 
Services are containerized using Docker and orchestrated via Kubernetes. 
The API gateway handles authentication, rate limiting, and request routing.
Observability is achieved through distributed tracing with OpenTelemetry.`,
    result: {
      sourceLanguage: 'en' as const,
      targetLanguage: 'zh' as const,
      translation: `该架构采用微服务模式，通过事件驱动进行通信。
服务使用 Docker 容器化，并通过 Kubernetes 进行编排。
API 网关负责处理认证、限流和请求路由。
可观测性通过 OpenTelemetry 的分布式追踪来实现。`,
      segments: [],
      notes: [
        {
          source: 'microservices',
          translation: '微服务',
          reason: '采用行业通用译法'
        },
        {
          source: 'orchestrated',
          translation: '编排',
          reason: '采用容器编排语境中的标准术语'
        }
      ]
    }
  }
};
