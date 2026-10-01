# qingteng-port-control-tool

青藤主机端口封禁控制工具

独立静态 Web 小工具，依据《青藤万相 v3.4.1.66 外部API手册》实现：

- 认证接口：`POST /v1/api/auth`
- 主机隔离：`POST /external/api/ms-srv/api/segmentation/create`
- 修改隔离：`POST /external/api/ms-srv/api/segmentation/edit`
- 解除隔离：`DELETE /external/api/ms-srv/api/segmentation/del`
- 黑名单策略：`POST /external/api/ms-srv/api/black-strategy/create`
- 暴力破解封停：`POST /external/api/detect/brutecrack/{linux,win}/block`

## 使用方式

推荐使用本地代理方式启动，避免浏览器跨域限制：

```bash
node server.js
```

然后打开：

```text
http://127.0.0.1:5177/
```

也可以直接用浏览器打开 `index.html`，但青藤 Console 如果没有开放 CORS，登录时会出现 `Failed to fetch`。

如果浏览器拦截跨域请求，可以把本目录放到和青藤 Console 同源的静态服务下，或在青藤 Console 前面配置允许跨域/反向代理。

## 关于封禁时长

API 手册中的微隔离和黑名单策略接口没有提供自动过期字段，暴力破解封停接口也只接收记录 ID 和封停/解封动作。本工具会计算到期时间，并把 `有效期至 ...; duration=...s` 写入 `remark`，便于人工或后续自动化任务按备注回收策略。