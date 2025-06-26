#!/bin/bash

# 测试安全验证检测功能
# 创建模拟日志文件来测试检测脚本

echo "🧪 测试安全验证检测功能..."

# 创建测试目录
mkdir -p test-logs

# 测试用例1: 包含安全验证的日志
echo "测试用例1: 检测 'Security Verification' 关键词"
cat > test-logs/test1.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 页面标题: Security Verification
[2024-01-01T10:00:03.000Z] [INFO] 需要验证
EOF

# 测试用例2: 包含中文安全验证的日志
echo "测试用例2: 检测中文 '安全验证' 关键词"
cat > test-logs/test2.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 页面标题: 小红书 - 安全验证
[2024-01-01T10:00:03.000Z] [INFO] 请完成验证
EOF

# 测试用例3: 正常日志（无安全验证）
echo "测试用例3: 正常日志（无安全验证）"
cat > test-logs/test3.log << EOF
[2024-01-01T10:00:00.000Z] [INFO] 开始小红书监控
[2024-01-01T10:00:01.000Z] [INFO] 页面导航成功
[2024-01-01T10:00:02.000Z] [INFO] 页面标题: labubu - 小红书搜索
[2024-01-01T10:00:03.000Z] [INFO] 找到 25 个帖子
EOF

# 设置测试环境变量
export BOT_TOKEN="test_token"
export CHAT_ID="test_chat_id"
export GITHUB_WORKFLOW="Test Workflow"
export GITHUB_RUN_NUMBER="123"

# 运行测试
echo ""
echo "🔍 运行检测测试..."

for i in {1..3}; do
    echo ""
    echo "--- 测试用例 $i ---"
    
    # 复制测试日志为监控日志
    cp "test-logs/test$i.log" monitoring.log
    
    # 运行检测脚本（但不实际发送Telegram消息）
    if [ -f "scripts/check-security-verification.sh" ]; then
        # 修改脚本以跳过实际的Telegram发送
        sed 's/curl -s -X POST/echo "模拟发送:" #curl -s -X POST/' scripts/check-security-verification.sh > temp-check-script.sh
        chmod +x temp-check-script.sh
        
        ./temp-check-script.sh
        EXIT_CODE=$?
        
        echo "退出码: $EXIT_CODE"
        
        if [ $EXIT_CODE -eq 2 ]; then
            echo "✅ 正确检测到安全验证"
        elif [ $EXIT_CODE -eq 0 ]; then
            echo "✅ 正确识别为正常日志"
        else
            echo "❌ 检测脚本执行出错"
        fi
        
        rm -f temp-check-script.sh
    else
        echo "❌ 检测脚本不存在"
    fi
done

# 清理测试文件
echo ""
echo "🧹 清理测试文件..."
rm -rf test-logs
rm -f monitoring.log

echo ""
echo "✅ 测试完成！"
