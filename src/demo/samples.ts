import type { TranslationResult } from '../store/translationStore';

export interface DemoSample {
  title: string;
  subtitle: string;
  input: string;
  result: TranslationResult;
}

export const DEMO_SAMPLES: DemoSample[] = [
  {
    title: '中文科技产品介绍',
    subtitle: '演示：中 → 英',
    input: `小米生态系统致力于为用户提供无缝的智能生活体验。
通过 MiMo Connect 协议，所有小米设备可以实现即时发现、
自动连接和智能协同。无论是手机、平板、电视还是智能家居，
都能在一个统一的平台上实现完美联动。`,
    result: {
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: `The Xiaomi ecosystem is committed to delivering a seamless smart living experience for users.
Through the MiMo Connect protocol, all Xiaomi devices can achieve instant discovery,
automatic connection, and intelligent coordination. Whether it's a phone, tablet, TV, or smart home device,
they can all work together perfectly on a unified platform.`,
      segments: [],
      notes: [
        {
          source: 'MiMo Connect',
          translation: 'MiMo Connect',
          reason: '品牌名按惯例保留原文，不翻译'
        }
      ]
    }
  },
  {
    title: 'Technical Documentation',
    subtitle: '演示：英 → 中',
    input: `The architecture employs a microservices pattern with event-driven communication. 
Services are containerized using Docker and orchestrated via Kubernetes. 
The API gateway handles authentication, rate limiting, and request routing.
Observability is achieved through distributed tracing with OpenTelemetry.`,
    result: {
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      translation: `该架构采用微服务模式，通过事件驱动进行通信。
服务使用 Docker 容器化，并通过 Kubernetes 进行编排。
API 网关负责处理认证、限流和请求路由。
可观测性通过 OpenTelemetry 的分布式追踪来实现。`,
      segments: [],
      notes: [
        {
          source: 'orchestrated',
          translation: '编排',
          reason: '容器编排领域的标准术语译法'
        }
      ]
    }
  },
  {
    title: '漫画对话分段翻译',
    subtitle: '演示：漫画模式分段结果',
    input: '',
    result: {
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      translation: 'Panel 1 — "We finally made it to the summit!"  ·  Panel 2 — Narrator: The wind never felt so free.  ·  SFX: WHOOSH',
      segments: [
        { type: 'dialogue', source: '我们终于登上山顶了！', translation: '"We finally made it to the summit!"' },
        { type: 'narration', source: '（旁白）风，从未如此自由。', translation: 'Narrator: The wind never felt so free.' },
        { type: 'sound_effect', source: '呼——', translation: 'WHOOSH' }
      ],
      notes: [
        {
          source: '呼——',
          translation: 'WHOOSH',
          reason: '拟声词按英文漫画习惯处理，不逐字直译'
        }
      ]
    }
  }
];
