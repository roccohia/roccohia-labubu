#!/bin/bash

# 小红书去重调试脚本
# 用于检查 xhs-seen-posts.json 文件的状态和内容

echo "🔍 小红书去重状态调试工具"
echo "================================"

# 设置文件路径
XHS_FILE="xhs-seen-posts.json"
BACKUP_FILE="xhs-seen-posts.json.backup"

echo ""
echo "📁 文件状态检查:"
echo "--------------------------------"

# 检查主文件
if [ -f "$XHS_FILE" ]; then
    echo "✅ 主文件存在: $XHS_FILE"
    
    # 文件大小
    FILE_SIZE=$(stat -f%z "$XHS_FILE" 2>/dev/null || stat -c%s "$XHS_FILE" 2>/dev/null || echo "未知")
    echo "📊 文件大小: $FILE_SIZE 字节"
    
    # 文件修改时间
    MODIFIED_TIME=$(stat -f%Sm "$XHS_FILE" 2>/dev/null || stat -c%y "$XHS_FILE" 2>/dev/null || echo "未知")
    echo "🕐 修改时间: $MODIFIED_TIME"
    
    # 检查文件内容
    echo ""
    echo "📋 文件内容分析:"
    echo "--------------------------------"
    
    if [ -s "$XHS_FILE" ]; then
        # 文件不为空
        echo "✅ 文件不为空"
        
        # 尝试解析JSON
        if jq . "$XHS_FILE" >/dev/null 2>&1; then
            echo "✅ JSON格式有效"
            
            # 获取数组长度
            ARRAY_LENGTH=$(jq 'length' "$XHS_FILE" 2>/dev/null || echo "0")
            echo "📊 记录数量: $ARRAY_LENGTH"
            
            # 显示最近的几条记录
            if [ "$ARRAY_LENGTH" -gt 0 ]; then
                echo ""
                echo "📝 最近的记录 (最多显示5条):"
                echo "--------------------------------"
                jq -r '.[-5:] | .[]' "$XHS_FILE" 2>/dev/null | head -5 | nl
                
                # 显示第一条记录
                echo ""
                echo "📝 最早的记录:"
                echo "--------------------------------"
                jq -r '.[0]' "$XHS_FILE" 2>/dev/null || echo "无法获取"
            else
                echo "⚠️ 文件为空数组"
            fi
        else
            echo "❌ JSON格式无效"
            echo "文件内容预览:"
            head -5 "$XHS_FILE"
        fi
    else
        echo "⚠️ 文件为空"
    fi
else
    echo "❌ 主文件不存在: $XHS_FILE"
fi

echo ""

# 检查备份文件
if [ -f "$BACKUP_FILE" ]; then
    echo "✅ 备份文件存在: $BACKUP_FILE"
    
    BACKUP_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null || echo "未知")
    echo "📊 备份文件大小: $BACKUP_SIZE 字节"
    
    if [ -s "$BACKUP_FILE" ] && jq . "$BACKUP_FILE" >/dev/null 2>&1; then
        BACKUP_LENGTH=$(jq 'length' "$BACKUP_FILE" 2>/dev/null || echo "0")
        echo "📊 备份记录数量: $BACKUP_LENGTH"
    fi
else
    echo "❌ 备份文件不存在: $BACKUP_FILE"
fi

echo ""
echo "🔧 环境信息:"
echo "--------------------------------"
echo "当前目录: $(pwd)"
echo "用户: $(whoami)"
echo "GitHub Actions: ${GITHUB_ACTIONS:-false}"
echo "工作流: ${GITHUB_WORKFLOW:-N/A}"
echo "运行编号: ${GITHUB_RUN_NUMBER:-N/A}"

# 检查目录权限
echo ""
echo "📁 目录权限:"
echo "--------------------------------"
ls -la . | grep -E "(xhs-seen-posts|\.)"

echo ""
echo "🔍 进程信息:"
echo "--------------------------------"
echo "PID: $$"
echo "PPID: $PPID"

# 如果在GitHub Actions环境中，输出更多调试信息
if [ "$GITHUB_ACTIONS" = "true" ]; then
    echo ""
    echo "🤖 GitHub Actions 特定信息:"
    echo "--------------------------------"
    echo "Runner OS: ${RUNNER_OS:-未知}"
    echo "Runner Temp: ${RUNNER_TEMP:-未知}"
    echo "GitHub Workspace: ${GITHUB_WORKSPACE:-未知}"
    echo "GitHub Event Name: ${GITHUB_EVENT_NAME:-未知}"
    
    # 检查工作空间权限
    if [ -n "$GITHUB_WORKSPACE" ] && [ -d "$GITHUB_WORKSPACE" ]; then
        echo "工作空间权限:"
        ls -la "$GITHUB_WORKSPACE" | head -10
    fi
fi

echo ""
echo "✅ 调试信息收集完成"
echo "================================"

# 如果文件存在但为空或损坏，尝试修复
if [ -f "$XHS_FILE" ]; then
    if [ ! -s "$XHS_FILE" ] || ! jq . "$XHS_FILE" >/dev/null 2>&1; then
        echo ""
        echo "🔧 检测到文件问题，尝试修复..."
        
        # 尝试从备份恢复
        if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ] && jq . "$BACKUP_FILE" >/dev/null 2>&1; then
            echo "📋 从备份文件恢复..."
            cp "$BACKUP_FILE" "$XHS_FILE"
            echo "✅ 从备份恢复成功"
        else
            echo "📋 创建新的空数组文件..."
            echo "[]" > "$XHS_FILE"
            echo "✅ 创建新文件成功"
        fi
    fi
fi
